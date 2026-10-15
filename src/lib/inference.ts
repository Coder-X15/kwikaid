// Photo -> Supabase storage -> inference_queue row -> worker writes a label back.
import { IMAGE_BUCKET, SUPABASE_URL, supabase } from "@/lib/supabase";

export type InferenceResult = {
  status: "completed" | "failed" | "timeout";
  label: string | null;
};

// Phone photos are often 3-5 MB; the model only needs 224px, so shrink to a
// 1024px JPEG before upload. Falls back to the original if the browser can't decode it.
async function downscale(file: File, maxSide = 1024): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.85),
    );
    return blob ?? file;
  } catch {
    return file;
  }
}

// Upload the photo into the user's folder and queue it. Returns the queue row id.
export async function submitPhoto(file: File): Promise<string> {
  const { data: auth } = await supabase.auth.getSession();
  const user = auth.session?.user;
  if (!user) throw new Error("You are signed out. Sign in again.");

  const image = await downscale(file);
  const ext = image.type.split("/")[1] ?? "jpg";
  const fileId =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const path = `${user.id}/${fileId}.${ext}`;

  const upload = await supabase.storage
    .from(IMAGE_BUCKET)
    .upload(path, image, { contentType: image.type || "image/jpeg" });
  if (upload.error) throw upload.error;

  // The bucket is private, so this URL only works with a signed-in user's token
  // or the worker's service key; the worker downloads by storage_path anyway.
  const { data, error } = await supabase
    .from("inference_queue")
    .insert({
      storage_path: path,
      storage_url: `${SUPABASE_URL}/storage/v1/object/authenticated/${IMAGE_BUCKET}/${path}`,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

// Poll the queue row until the worker marks it completed or failed.
// onStatus reports each status seen ("queued", "processing", ...) for the progress UI.
export async function waitForInference(
  id: string,
  signal: AbortSignal,
  onStatus?: (status: string) => void,
  timeoutMs = 45_000,
  intervalMs = 1_500,
): Promise<InferenceResult> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !signal.aborted) {
    const { data, error } = await supabase
      .from("inference_queue")
      .select("status, inference")
      .eq("id", id)
      .single();
    if (error) throw error;
    onStatus?.(data.status as string);
    if (data.status === "completed")
      return { status: "completed", label: data.inference as string };
    if (data.status === "failed") return { status: "failed", label: null };
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return { status: "timeout", label: null };
}

// Model class name -> protocol key in firstaid.ts. Extend this once the model's
// final class list is known; unknown labels fall back to a manual pick.
const LABEL_ALIASES: Record<string, string> = {
  cut: "cut",
  cuts: "cut",
  laceration: "cut",
  laseration: "cut",
  abrasion: "cut",
  abrasions: "cut",
  bruise: "bruise",
  bruises: "bruise",
  ingrown_nail: "ingrown_nail",
  ingrown_nails: "ingrown_nail",
  burn: "burn",
  burns: "burn",
  scald: "burn",
  fracture: "fracture",
  fractures: "fracture",
  broken_bone: "fracture",
  bleed: "bleed",
  bleeding: "bleed",
  haemorrhage: "bleed",
  hemorrhage: "bleed",
  stab_wound: "bleed",
  sprain: "sprain",
  sprains: "sprain",
  choking: "choking",
};

export function labelToInjury(label: string | null): string | null {
  if (!label) return null;
  const key = label.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return LABEL_ALIASES[key] ?? null;
}
