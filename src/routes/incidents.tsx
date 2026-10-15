import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PhoneCall, PhoneOff, ClipboardList } from "lucide-react";
import { AppFrame } from "@/components/AppFrame";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SEVERITY_LABEL, type Incident } from "@/lib/firstaid";
import { listIncidents } from "@/lib/incidents";

export const Route = createFileRoute("/incidents")({
  head: () => ({
    meta: [
      { title: "Incident Log — KwikAid" },
      {
        name: "description",
        content: "Review logged first-aid incidents, observed symptoms, completed steps and whether an emergency call was placed.",
      },
      { property: "og:title", content: "Incident Log — KwikAid" },
      { property: "og:description", content: "Every logged incident with symptoms, steps completed and call status." },
    ],
  }),
  component: IncidentsPage,
});

function IncidentsPage() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listIncidents()
      .then(setIncidents)
      .catch((err: { message?: string }) => setError(err.message ?? "Could not load incidents."))
      .finally(() => setLoading(false));
  }, []);

  return (
    <AppFrame>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Incident log</h1>
          <p className="text-sm text-muted-foreground">
            {loading
              ? "Loading your incidents…"
              : `${incidents.length} recorded ${incidents.length === 1 ? "incident" : "incidents"} in your account.`}
          </p>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {!loading && !error && incidents.length === 0 && (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
              <ClipboardList className="size-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No incidents yet. Start an assessment to create one.</p>
            </CardContent>
          </Card>
        )}

        {incidents.map((i) => (
          <Card key={i.id}>
            <CardHeader className="flex flex-row flex-wrap items-center gap-3">
              <CardTitle className="text-base">{i.label}</CardTitle>
              <Badge variant={i.severity === "severe" ? "destructive" : "secondary"}>{SEVERITY_LABEL[i.severity]}</Badge>
              <span className="ml-auto text-xs text-muted-foreground">
                {i.id} · {new Date(i.createdAt).toLocaleString()}
              </span>
            </CardHeader>
            <CardContent className="grid gap-5 text-sm sm:grid-cols-2">
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Symptoms observed</p>
                <ul className="space-y-1">
                  {i.symptoms.map((s) => (
                    <li key={s} className="text-foreground">
                      · {s}
                    </li>
                  ))}
                </ul>
                {i.photoName && <p className="text-xs text-muted-foreground">Photo: {i.photoName}</p>}
              </div>
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Response</p>
                <p>
                  Steps completed: {i.stepsDone}/{i.stepsTotal}
                </p>
                <p className="flex items-center gap-2">
                  {i.callPlaced ? (
                    <>
                      <PhoneCall className="size-4 text-destructive" /> Emergency call placed to {i.callNumber}
                    </>
                  ) : (
                    <>
                      <PhoneOff className="size-4 text-muted-foreground" /> No call placed
                    </>
                  )}
                </p>
                {i.notes.length > 0 && (
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {i.notes.map((n, idx) => (
                      <li key={idx}>· {n}</li>
                    ))}
                  </ul>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </AppFrame>
  );
}
