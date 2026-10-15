// Incident log, stored in Supabase. Row-level security keeps each user's
// incidents private, so this never needs to filter by user itself.
import type { Incident, Severity } from "@/lib/firstaid";
import { supabase } from "@/lib/supabase";

type IncidentRow = {
  id: string;
  created_at: string;
  injury_type: string;
  label: string;
  severity: Severity;
  symptoms: string[];
  photo_name: string | null;
  steps_total: number;
  steps_done: number;
  call_placed: boolean;
  call_number: string | null;
  notes: string[];
};

export function newIncidentId() {
  return `INC-${Date.now().toString(36).toUpperCase()}`;
}

export async function listIncidents(): Promise<Incident[]> {
  const { data, error } = await supabase
    .from("incidents")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as IncidentRow[]).map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    injuryType: r.injury_type,
    label: r.label,
    severity: r.severity,
    symptoms: r.symptoms,
    photoName: r.photo_name,
    stepsTotal: r.steps_total,
    stepsDone: r.steps_done,
    callPlaced: r.call_placed,
    callNumber: r.call_number,
    notes: r.notes,
  }));
}

// The assist page re-saves the same incident as the user works through the
// steps, so this upserts. created_at is left to the database default, which
// keeps the original time on later saves. Failures are logged, not thrown:
// a logging problem must never interrupt first-aid guidance.
export async function saveIncident(incident: Incident) {
  const { error } = await supabase.from("incidents").upsert({
    id: incident.id,
    injury_type: incident.injuryType,
    label: incident.label,
    severity: incident.severity,
    symptoms: incident.symptoms,
    photo_name: incident.photoName,
    steps_total: incident.stepsTotal,
    steps_done: incident.stepsDone,
    call_placed: incident.callPlaced,
    call_number: incident.callNumber,
    notes: incident.notes,
  });
  if (error) console.error("Saving incident failed:", error.message);
}
