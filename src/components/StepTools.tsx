// Hands-free helpers for the person giving first aid: read the step aloud,
// count down timed steps, and keep the screen from dimming.
import { useEffect, useState } from "react";
import { Timer, Volume2, VolumeX } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

const canSpeak = () => typeof window !== "undefined" && "speechSynthesis" in window;

function say(text: string) {
  if (!canSpeak()) return;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
}

// "Press ... for 5 full minutes" -> 300. Picks the first duration in the text.
function durationSeconds(text: string): number | null {
  const m = /(\d+)\s*(?:full\s+)?(minutes?|seconds?)/i.exec(text);
  if (!m?.[1] || !m[2]) return null;
  return Number(m[1]) * (m[2].toLowerCase().startsWith("min") ? 60 : 1);
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export function StepTools({ title, detail }: { title: string; detail: string }) {
  const [readAloud, setReadAloud] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const duration = durationSeconds(detail);

  // New step: stop any running timer.
  useEffect(() => setRemaining(null), [title, detail]);

  // Read the step out when it changes or when reading is switched on.
  useEffect(() => {
    if (readAloud) say(`${title}. ${detail}`);
  }, [title, detail, readAloud]);

  useEffect(() => () => (canSpeak() ? window.speechSynthesis.cancel() : undefined), []);

  useEffect(() => {
    if (remaining === null) return;
    if (remaining <= 0) {
      setRemaining(null);
      toast.success(`Time's up: ${title}`);
      if (readAloud) say("Time is up.");
      navigator.vibrate?.([300, 150, 300]);
      return;
    }
    const t = window.setTimeout(() => setRemaining(remaining - 1), 1000);
    return () => window.clearTimeout(t);
  }, [remaining, title, readAloud]);

  return (
    <div className="flex flex-wrap gap-2">
      {canSpeak() && (
        <Button
          variant="outline"
          size="sm"
          aria-pressed={readAloud}
          onClick={() => {
            if (readAloud && canSpeak()) window.speechSynthesis.cancel();
            setReadAloud(!readAloud);
          }}
        >
          {readAloud ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
          {readAloud ? "Reading aloud" : "Read aloud"}
        </Button>
      )}
      {duration !== null && (
        <Button
          variant={remaining === null ? "outline" : "secondary"}
          size="sm"
          onClick={() => setRemaining(remaining === null ? duration : null)}
        >
          <Timer className="size-4" />
          {remaining === null ? `Start ${mmss(duration)} timer` : `${mmss(remaining)} · stop`}
        </Button>
      )}
    </div>
  );
}

// Keep the screen on while `active` (supported in Chrome/Edge/Safari 16.4+).
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = () =>
      navigator.wakeLock
        .request("screen")
        .then((l) => (cancelled ? void l.release() : void (lock = l)))
        .catch(() => undefined);
    // The browser drops the lock when the tab is hidden; take it again on return.
    const onVisible = () => document.visibilityState === "visible" && acquire();
    void acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release();
    };
  }, [active]);
}
