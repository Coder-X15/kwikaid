import { createClient } from "@supabase/supabase-js";

// The URL and publishable key are safe to ship to the browser: row-level
// security decides what each signed-in user can read or write.
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  throw new Error(
    "Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY. Copy .env.example to .env and fill it in.",
  );
}

export const SUPABASE_URL = url;
export const supabase = createClient(url, key);

// Private bucket; each user uploads into a folder named after their user id.
export const IMAGE_BUCKET = "injury-images";
