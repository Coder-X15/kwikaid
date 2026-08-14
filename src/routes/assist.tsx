import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { Camera, Check, ChevronRight, MessageCircle, Phone, RotateCcw, Stethoscope } from "lucide-react";
import { AppFrame } from "@/components/AppFrame";
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
  newIncidentId,
  saveIncident,
  SEVERITY_LABEL,
  type Incident,
  type Protocol,
} from "@/lib/firstaid";

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

function AssistPage() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("capture");
  const [injuryType, setInjuryType] = useState<string>("cut");
  const [photo, setPhoto] = useState<{ name: string; url: string } | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [protocol, setProtocol] = useState<Protocol | null>(null);
  const [incidentId, setIncidentId] = useState<string>("");
  const [stepIndex, setStepIndex] = useState(0);
  const [callPlaced, setCallPlaced] = useState(false);
  const [thread, setThread] = useState<{ role: "user" | "agent"; text: string }[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [command, setCommand] = useState("");

  const stepsDone = useMemo(
    () => (protocol ? Math.min(stepIndex, protocol.steps.length) : 0),
    [protocol, stepIndex],
  );

  function persist(next: Partial<Incident>) {
    if (!protocol) return;
    const record: Incident = {
      id: incidentId,
      createdAt: new Date().toISOString(),
      injuryType,
      label: protocol.label,
      severity: protocol.severity,
      symptoms: protocol.symptoms,
      photoName: photo?.name ?? null,
      stepsTotal: protocol.steps.length,
      stepsDone,
      callPlaced,
      callNumber: callPlaced ? EMERGENCY_NUMBER : null,
      notes,
      ...next,
    };
    saveIncident(record);
  }

  function onPickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhoto({ name: file.name, url: URL.createObjectURL(file) });
  }

  function analyse() {
    setAnalysing(true);
    const found = assess(injuryType);
    const id = newIncidentId();
    window.setTimeout(() => {
      setProtocol(found);
      setIncidentId(id);
      setStepIndex(0);
      setPhase("steps");
      setAnalysing(false);
      const autoCall = found.severity === "severe";
      const baseNotes = ["Assessment opened from photo analysis (simulated)."];
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
      }
      const record: Incident = {
        id,
        createdAt: new Date().toISOString(),
        injuryType,
        label: found.label,
        severity: found.severity,
        symptoms: found.symptoms,
        photoName: photo?.name ?? null,
        stepsTotal: found.steps.length,
        stepsDone: 0,
        callPlaced: autoCall,
        callNumber: autoCall ? EMERGENCY_NUMBER : null,
        notes: baseNotes,
      };
      setNotes(record.notes);
      saveIncident(record);
    }, 900);
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

  function reset() {
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
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Camera className="size-5 text-primary" /> Capture the injury
              </CardTitle>
              <CardDescription>
                Take or upload a photo, confirm what you are looking at, and the assistant will build a response
                protocol.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="grid w-full place-items-center gap-2 rounded-lg border-2 border-dashed border-border bg-muted/40 py-12 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-primary"
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
              {photo && <p className="text-xs text-muted-foreground">Attached: {photo.name}</p>}
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={onPickPhoto}
              />

              <div className="space-y-2">
                <p className="text-sm font-medium text-foreground">What does the injury look like?</p>
                <Select value={injuryType} onValueChange={setInjuryType}>
                  <SelectTrigger>
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
              </div>

              <Button className="w-full" disabled={analysing} onClick={analyse}>
                <Stethoscope className="size-4" />
                {analysing ? "Analysing photo…" : "Analyse and build protocol"}
              </Button>
            </CardContent>
          </Card>
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
                    <h3 className="text-lg font-semibold text-foreground">{protocol.steps[stepIndex]?.title}</h3>
                    <p className="text-sm text-muted-foreground">{protocol.steps[stepIndex]?.detail}</p>
                    <div className="flex gap-2">
                      <Button onClick={nextStep}>
                        {stepIndex + 1 === protocol.steps.length ? "Finish protocol" : "Step done, next"}
                        <ChevronRight className="size-4" />
                      </Button>
                      {stepIndex > 0 && (
                        <Button variant="ghost" onClick={() => setStepIndex((i) => Math.max(0, i - 1))}>
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

        {protocol && phase === "followup" && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <MessageCircle className="size-5 text-primary" /> Follow-up on this situation
              </CardTitle>
              <CardDescription>Check your technique or ask what happens next.</CardDescription>
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
              <div className="flex flex-wrap gap-2">
                {protocol.followUps.map((f) => (
                  <Button key={f.question} variant="outline" size="sm" onClick={() => ask(f.question, f.answer)}>
                    {f.question}
                  </Button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2 pt-2">
                {!callPlaced && (
                  <Button variant="destructive" onClick={() => placeCall("placed on your command")}>
                    <Phone className="size-4" /> Escalate — call {EMERGENCY_NUMBER}
                  </Button>
                )}
                <Button variant="secondary" onClick={reset}>
                  <RotateCcw className="size-4" /> New assessment
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppFrame>
  );
}
