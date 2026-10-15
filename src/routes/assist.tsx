import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bandage,
  Bone,
  Camera,
  Check,
  ChevronRight,
  Circle,
  CircleCheck,
  Droplet,
  Flame,
  Footprints,
  Hospital,
  Loader2,
  MessageCircle,
  Phone,
  ScanSearch,
  Siren,
  Stethoscope,
  TriangleAlert,
  Wind,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { AppFrame } from "@/components/AppFrame";
import { StepTools, useWakeLock } from "@/components/StepTools";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  assess,
  EMERGENCY_NUMBER,
  INJURY_TYPES,
  SEVERITY_LABEL,
  type Incident,
  type Protocol,
} from "@/lib/firstaid";
import { newIncidentId, saveIncident } from "@/lib/incidents";
import { labelToInjury, submitPhoto, waitForInference } from "@/lib/inference";

export const Route = createFileRoute("/assist")({
  head: () => ({
    meta: [
      { title: "Guided Assessment — KwikAid" },
      {
        name: "description",
        content:
          "Upload a photo of an injury, receive a step-by-step first-aid protocol, escalate to emergency services and ask follow-up questions.",
      },
      { property: "og:title", content: "Guided Assessment — KwikAid" },
      {
        property: "og:description",
        content: "Photo-led triage with step-by-step first-aid instructions and simulated emergency escalation.",
      },
    ],
  }),
  component: AssistPage,
});

type Phase = "capture" | "steps" | "followup";

// Photo pipeline stages; "queued" and "processing" mirror inference_queue.status.
type Stage = "idle" | "uploading" | "queued" | "processing" | "done";

const PIPELINE: { stage: Stage; label: string }[] = [
  { stage: "uploading", label: "Uploading photo" },
  { stage: "queued", label: "Queued for the CV model" },
  { stage: "processing", label: "Model analysing the image" },
  { stage: "done", label: "Result ready" },
];

// What came back for a photo: `suggested` is the matching protocol, if any;
// `problem` explains why there is none.
type PhotoResult = {
  label: string | null;
  suggested: string | null;
  queueId: string | null;
  problem: string | null;
};

const SCENARIO_ICONS: Record<string, LucideIcon> = {
  cut: Bandage,
  burn: Flame,
  fracture: Bone,
  bleed: Droplet,
  sprain: Footprints,
  choking: Wind,
};

const isSevere = (value: string) => assess(value).severity === "severe";

// Life-threatening scenarios first.
const SCENARIOS = [...INJURY_TYPES].sort((a, b) => Number(isSevere(b.value)) - Number(isSevere(a.value)));

const injuryLabel = (value: string) => INJURY_TYPES.find((t) => t.value === value)?.label ?? value;
const isNoneLabel = (label: string | null) => label?.trim().toLowerCase() === "none";

const HOSPITAL_SEARCH = "https://www.google.com/maps/search/hospital+near+me";

function PipelineProgress({ stage }: { stage: Stage }) {
  const current = PIPELINE.findIndex((p) => p.stage === stage);
  return (
    <ol role="status" aria-live="polite" className="space-y-2 rounded-lg border border-border bg-muted/30 p-4 text-sm">
      {PIPELINE.map((p, i) => {
        const done = i < current || stage === "done";
        const active = i === current && stage !== "done";
        return (
          <li
            key={p.stage}
            className={`flex items-center gap-2 ${done || active ? "text-foreground" : "text-muted-foreground"}`}
          >
            {done ? (
              <CircleCheck className="size-4 text-primary" />
            ) : active ? (
              <Loader2 className="size-4 animate-spin text-primary" />
            ) : (
              <Circle className="size-4" />
            )}
            {p.label}
          </li>
        );
      })}
    </ol>
  );
}

function AssistPage() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("capture");
  const [injuryType, setInjuryType] = useState<string>("cut");
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [result, setResult] = useState<PhotoResult | null>(null);
  const polling = useRef<AbortController | null>(null);
  const [protocol, setProtocol] = useState<Protocol | null>(null);
  const [incidentId, setIncidentId] = useState<string>("");
  const [stepIndex, setStepIndex] = useState(0);
  const [callPlaced, setCallPlaced] = useState(false);
  const [thread, setThread] = useState<{ role: "user" | "agent"; text: string }[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [command, setCommand] = useState("");

  const busy = stage === "uploading" || stage === "queued" || stage === "processing";

  const stepsDone = useMemo(
    () => (protocol ? Math.min(stepIndex, protocol.steps.length) : 0),
    [protocol, stepIndex],
  );

  // Stop polling the queue if the user leaves the page mid-analysis.
  useEffect(() => () => polling.current?.abort(), []);

  // Hands are busy during first aid: keep the screen on while steps are shown.
  useWakeLock(phase === "steps");

  function persist(next: Partial<Incident>) {
    if (!protocol) return;
    const record: Incident = {
      id: incidentId,
      createdAt: new Date().toISOString(),
      injuryType,
      label: protocol.label,
      severity: protocol.severity,
      symptoms: protocol.symptoms,
      photoName: photo?.file.name ?? null,
      stepsTotal: protocol.steps.length,
      stepsDone,
      callPlaced,
      callNumber: callPlaced ? EMERGENCY_NUMBER : null,
      notes,
      ...next,
    };
    void saveIncident(record);
  }

  function onPickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    polling.current?.abort();
    setPhoto({ file, url: URL.createObjectURL(file) });
    setStage("idle");
    setResult(null);
  }

  // Image path: upload, queue, wait for the CV worker's label, then let the
  // user confirm the detected scenario before any guidance starts.
  async function analysePhoto() {
    if (!photo) return;
    polling.current?.abort();
    const controller = new AbortController();
    polling.current = controller;
    setResult(null);
    try {
      setStage("uploading");
      const queueId = await submitPhoto(photo.file);
      setStage("queued");
      const r = await waitForInference(queueId, controller.signal, (status) => {
        if (status === "queued" || status === "processing") setStage(status);
      });
      if (controller.signal.aborted) return;
      const suggested = labelToInjury(r.label);
      if (suggested) setInjuryType(suggested);
      setStage("done");
      setResult({
        label: r.label,
        suggested,
        queueId,
        problem:
          r.status === "completed"
            ? suggested
              ? null
              : `The model labelled this photo "${r.label}", which has no matching protocol.`
            : r.status === "failed"
              ? "The model could not process this photo."
              : "The model did not answer in time.",
      });
    } catch (err) {
      if (controller.signal.aborted) return;
      const message = (err as { message?: string }).message ?? "Uploading the photo failed.";
      setStage("idle");
      setResult({ label: null, suggested: null, queueId: null, problem: message });
      toast.error("Could not analyse the photo", { description: message });
    }
  }

  function confirmDetection() {
    if (!result?.suggested) return;
    chooseScenario(
      result.suggested,
      `Photo classified by the CV model as "${result.label}" (queue row ${result.queueId}); confirmed by the user.`,
    );
  }

  function pickManually() {
    const why = result?.suggested
      ? `model said "${result.label}", corrected by the user`
      : (result?.problem ?? "no model result");
    chooseScenario(injuryType, `Photo submitted; scenario picked manually (${why}).`);
  }

  // Button path, and the photo path once the user has confirmed a scenario.
  function chooseScenario(type: string, note: string) {
    polling.current?.abort();
    setStage("idle");
    startProtocol(type, note);
  }

  function startProtocol(type: string, sourceNote: string) {
    const found = assess(type);
    const id = newIncidentId();
    setInjuryType(type);
    setResult(null);
    setProtocol(found);
    setIncidentId(id);
    setStepIndex(0);
    setPhase("steps");
    const autoCall = found.severity === "severe";
    const baseNotes = [sourceNote];
    if (autoCall) {
      baseNotes.push(
        `Agent judged the injury severe and placed an emergency call to ${EMERGENCY_NUMBER} automatically (simulated).`,
      );
      setCallPlaced(true);
      setThread((t) => [
        ...t,
        {
          role: "agent",
          text: `This looks severe, so I have already dialled ${EMERGENCY_NUMBER} for you. Keep following the steps while help is on the way.`,
        },
      ]);
      toast.warning(`Severe injury: calling ${EMERGENCY_NUMBER} automatically (simulated)`);
    }
    const record: Incident = {
      id,
      createdAt: new Date().toISOString(),
      injuryType: type,
      label: found.label,
      severity: found.severity,
      symptoms: found.symptoms,
      photoName: photo?.file.name ?? null,
      stepsTotal: found.steps.length,
      stepsDone: 0,
      callPlaced: autoCall,
      callNumber: autoCall ? EMERGENCY_NUMBER : null,
      notes: baseNotes,
    };
    setNotes(record.notes);
    void saveIncident(record);
  }

  function nextStep() {
    if (!protocol) return;
    const next = stepIndex + 1;
    setStepIndex(next);
    if (next >= protocol.steps.length) {
      setPhase("followup");
      persist({ stepsDone: protocol.steps.length });
    } else {
      persist({ stepsDone: next });
    }
  }

  // Before any protocol has started there is no incident to log the call against.
  function quickCall() {
    toast.success(`Calling ${EMERGENCY_NUMBER} (simulated)`, {
      description: "In a real emergency, dial it from your phone.",
    });
  }

  function placeCall(reason = "placed on your command") {
    if (callPlaced) return;
    setCallPlaced(true);
    const note = `Emergency call to ${EMERGENCY_NUMBER} ${reason} (simulated) at ${new Date().toLocaleTimeString()}.`;
    const nextNotes = [...notes, note];
    setNotes(nextNotes);
    setThread((t) => [
      ...t,
      { role: "agent", text: `Dialling ${EMERGENCY_NUMBER} now — stay with the casualty and keep them still.` },
    ]);
    toast.success(`Calling ${EMERGENCY_NUMBER} (simulated)`);
    persist({ callPlaced: true, callNumber: EMERGENCY_NUMBER, notes: nextNotes });
  }

  function runCommand(raw: string) {
    const text = raw.trim();
    if (!text) return;
    setCommand("");
    setThread((t) => [...t, { role: "user", text }]);
    const wantsCall = /call|ambulance|emergency|medic|112|911|999|paramedic/i.test(text);
    if (wantsCall) {
      if (callPlaced) {
        setThread((t) => [
          ...t,
          { role: "agent", text: `The call to ${EMERGENCY_NUMBER} is already active — stay on the line.` },
        ]);
        return;
      }
      placeCall("placed on your command");
      return;
    }
    const answer =
      protocol?.followUps.find((f) => text.toLowerCase().split(/\s+/).some((w) => w.length > 3 && f.question.toLowerCase().includes(w)))
        ?.answer ??
      "Noted. Keep working through the steps, and say \"call an ambulance\" any time you want me to dial emergency services.";
    setThread((t) => [...t, { role: "agent", text: answer }]);
    const nextNotes = [...notes, `Command: ${text}`];
    setNotes(nextNotes);
    persist({ notes: nextNotes });
  }

  function ask(question: string, answer: string) {
    setThread((t) => [...t, { role: "user", text: question }, { role: "agent", text: answer }]);
    const nextNotes = [...notes, `Follow-up: ${question}`];
    setNotes(nextNotes);
    persist({ notes: nextNotes });
  }

  function finish() {
    persist({ notes: [...notes, "Closed by the user: no further help needed."] });
    toast.success("Incident saved to your log");
    reset();
  }

  function reset() {
    polling.current?.abort();
    setStage("idle");
    setResult(null);
    setPhase("capture");
    setProtocol(null);
    setPhoto(null);
    setStepIndex(0);
    setCallPlaced(false);
    setThread([]);
    setNotes([]);
    setCommand("");
    setIncidentId("");
  }

  return (
    <AppFrame>
      <div className="space-y-6">
        {phase === "capture" && (
          <>
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
              <Siren className="size-5 shrink-0 text-destructive" />
              <p className="min-w-48 flex-1 text-sm text-foreground">
                Unresponsive, not breathing or bleeding heavily? Call emergency services first.
              </p>
              <Button variant="destructive" onClick={quickCall}>
                <Phone className="size-4" /> Call {EMERGENCY_NUMBER}
              </Button>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Stethoscope className="size-5 text-primary" /> What happened?
                </CardTitle>
                <CardDescription>
                  Tap the situation for step-by-step guidance. Red ones are life-threatening.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                {SCENARIOS.map((t) => {
                  const Icon = SCENARIO_ICONS[t.value] ?? Stethoscope;
                  return (
                    <Button
                      key={t.value}
                      variant="outline"
                      className={`h-14 justify-start gap-3 text-base ${
                        isSevere(t.value)
                          ? "border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                          : ""
                      }`}
                      onClick={() => chooseScenario(t.value, `Scenario chosen by button: ${t.label}.`)}
                    >
                      <Icon className="size-5" />
                      {t.label}
                    </Button>
                  );
                })}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Camera className="size-5 text-primary" /> Or photograph the injury
                </CardTitle>
                <CardDescription>
                  For wounds and burns: take or upload a photo and the CV model will identify it.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  disabled={busy}
                  className="grid w-full place-items-center gap-2 rounded-lg border-2 border-dashed border-border bg-muted/40 py-12 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:pointer-events-none"
                >
                  {photo ? (
                    <img src={photo.url} alt="Captured injury" className="max-h-56 rounded-md object-contain" />
                  ) : (
                    <>
                      <Camera className="size-7" />
                      Tap to take or upload a photo
                    </>
                  )}
                </button>
                <p className="text-xs text-muted-foreground">
                  {photo ? `Attached: ${photo.file.name}. ` : ""}
                  Tip: fill the frame with the injury, use good light and avoid busy backgrounds.
                </p>
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={onPickPhoto}
                />

                <Button className="w-full" disabled={!photo || busy} onClick={analysePhoto}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <ScanSearch className="size-4" />}
                  {busy ? "Analysing…" : stage === "done" ? "Analyse again" : "Analyse photo"}
                </Button>

                {stage !== "idle" && <PipelineProgress stage={stage} />}

                {result && (
                  <div
                    className={`space-y-3 rounded-lg border p-4 ${
                      result.suggested ? "border-primary/30 bg-primary/5" : "border-destructive/30 bg-destructive/5"
                    }`}
                  >
                    {result.suggested ? (
                      <>
                        <p className="flex items-start gap-2 text-sm text-foreground">
                          <ScanSearch className="mt-0.5 size-4 shrink-0 text-primary" />
                          <span>
                            The CV model detected <strong>{result.label}</strong>. Matching protocol:{" "}
                            <strong>{injuryLabel(result.suggested)}</strong>.
                          </span>
                        </p>
                        <Button className="w-full" onClick={confirmDetection}>
                          <Check className="size-4" /> Confirm and start guidance
                        </Button>
                        <p className="text-xs text-muted-foreground">Not right? Choose the correct situation:</p>
                      </>
                    ) : isNoneLabel(result.label) ? (
                      <p className="flex items-start gap-2 text-sm text-foreground">
                        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                        No injury category was detected. If one of the situations above applies, select its button
                        above. If none applies, ignore this result.
                      </p>
                    ) : (
                      <p className="flex items-start gap-2 text-sm text-foreground">
                        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
                        {result.problem} Pick the closest match to continue.
                      </p>
                    )}
                    {!isNoneLabel(result.label) && (
                      <div className="flex flex-wrap gap-2">
                        <Select value={injuryType} onValueChange={setInjuryType}>
                          <SelectTrigger className="min-w-48 flex-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {INJURY_TYPES.map((t) => (
                              <SelectItem key={t.value} value={t.value}>
                                {t.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button variant={result.suggested ? "outline" : "default"} onClick={pickManually}>
                          Start protocol
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}

        {protocol && phase !== "capture" && (
          <>
            <Card>
              <CardHeader className="flex flex-row flex-wrap items-center gap-3">
                <div>
                  <CardTitle className="text-base">{protocol.label}</CardTitle>
                  <CardDescription>Incident {incidentId}</CardDescription>
                </div>
                <Badge
                  className="ml-auto"
                  variant={protocol.severity === "severe" ? "destructive" : "secondary"}
                >
                  {SEVERITY_LABEL[protocol.severity]}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  {protocol.symptoms.map((s) => (
                    <span key={s} className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
                      {s}
                    </span>
                  ))}
                </div>
                {protocol.severity === "severe" && (
                  <div className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                    <p className="text-sm text-foreground">
                      {callPlaced
                        ? `Emergency services contacted on ${EMERGENCY_NUMBER}. Stay on the line.`
                        : `Severity warrants emergency services. Place a call to ${EMERGENCY_NUMBER} now.`}
                    </p>
                    <Button
                      variant={callPlaced ? "secondary" : "destructive"}
                      className="ml-auto"
                      disabled={callPlaced}
                      onClick={() => placeCall("placed on your command")}
                    >
                      <Phone className="size-4" />
                      {callPlaced ? "Call placed" : `Call ${EMERGENCY_NUMBER}`}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  {phase === "steps" ? `Step ${stepIndex + 1} of ${protocol.steps.length}` : "All steps completed"}
                </CardTitle>
                <Progress value={(stepsDone / protocol.steps.length) * 100} className="mt-2" />
              </CardHeader>
              <CardContent className="space-y-4">
                {phase === "steps" ? (
                  <>
                    <h3 className="text-xl font-semibold text-foreground">{protocol.steps[stepIndex]?.title}</h3>
                    <p className="text-base text-muted-foreground">{protocol.steps[stepIndex]?.detail}</p>
                    <StepTools
                      title={protocol.steps[stepIndex]?.title ?? ""}
                      detail={protocol.steps[stepIndex]?.detail ?? ""}
                    />
                    <div className="flex gap-2">
                      <Button size="lg" onClick={nextStep}>
                        {stepIndex + 1 === protocol.steps.length ? "Finish protocol" : "Step done, next"}
                        <ChevronRight className="size-4" />
                      </Button>
                      {stepIndex > 0 && (
                        <Button variant="ghost" size="lg" onClick={() => setStepIndex((i) => Math.max(0, i - 1))}>
                          Back
                        </Button>
                      )}
                    </div>
                  </>
                ) : (
                  <ol className="space-y-2 text-sm">
                    {protocol.steps.map((s) => (
                      <li key={s.title} className="flex gap-2 text-muted-foreground">
                        <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                        <span>
                          <span className="font-medium text-foreground">{s.title}</span> — {s.detail}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </CardContent>
            </Card>
          </>
        )}

        {protocol && phase === "followup" && (
          <Card className="border-primary/40">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <CircleCheck className="size-5 text-primary" /> Do you need further help?
              </CardTitle>
              <CardDescription>You've completed the protocol. Choose what you need next.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-2 sm:grid-cols-3">
                <Button
                  variant={callPlaced ? "secondary" : "destructive"}
                  disabled={callPlaced}
                  onClick={() => placeCall("placed after the protocol")}
                >
                  <Phone className="size-4" />
                  {callPlaced ? "Call placed" : `Call ${EMERGENCY_NUMBER}`}
                </Button>
                <Button variant="outline" asChild>
                  <a href={HOSPITAL_SEARCH} target="_blank" rel="noreferrer">
                    <Hospital className="size-4" /> Find nearest hospital
                  </a>
                </Button>
                <Button onClick={finish}>
                  <Check className="size-4" /> No, I'm done
                </Button>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium text-foreground">Common questions</p>
                <div className="flex flex-wrap gap-2">
                  {protocol.followUps.map((f) => (
                    <Button key={f.question} variant="outline" size="sm" onClick={() => ask(f.question, f.answer)}>
                      {f.question}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">Or type your own question to the agent below.</p>
              </div>
            </CardContent>
          </Card>
        )}

        {protocol && phase !== "capture" && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <MessageCircle className="size-5 text-primary" /> Talk to the agent
              </CardTitle>
              <CardDescription>
                Ask a question, or tell it to call for help — it will also dial on its own if the injury looks severe.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {thread.length > 0 && (
                <div className="space-y-3">
                  {thread.map((m, idx) => (
                    <div
                      key={idx}
                      className={
                        m.role === "user"
                          ? "ml-auto max-w-[85%] rounded-lg rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground"
                          : "max-w-[85%] rounded-lg rounded-bl-sm bg-muted px-3 py-2 text-sm text-foreground"
                      }
                    >
                      {m.text}
                    </div>
                  ))}
                  <Separator />
                </div>
              )}
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  runCommand(command);
                }}
              >
                <Input
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder='e.g. "call an ambulance"'
                />
                <Button type="submit" variant="secondary">
                  Send
                </Button>
              </form>
              <Button
                variant={callPlaced ? "secondary" : "destructive"}
                className="w-full"
                disabled={callPlaced}
                onClick={() => placeCall("placed on your command")}
              >
                <Phone className="size-4" />
                {callPlaced ? `Call to ${EMERGENCY_NUMBER} active` : `Tell the agent to call ${EMERGENCY_NUMBER}`}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </AppFrame>
  );
}
