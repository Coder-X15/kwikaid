import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Activity, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "KwikAid — Guided First-Aid Assistant" },
      {
        name: "description",
        content:
          "Sign in to KwikAid to photograph an injury, follow step-by-step first-aid guidance, and log incidents and emergency calls.",
      },
      { property: "og:title", content: "KwikAid — Guided First-Aid Assistant" },
      {
        property: "og:description",
        content: "Photograph an injury, get step-by-step first-aid guidance, and keep an incident record.",
      },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "register">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Already signed in? Skip straight to the app.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/assist", replace: true });
    });
  }, [navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    const { data, error } =
      mode === "signin"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    // signUp returns no session while "Confirm email" is switched on in Supabase.
    if (data.session) navigate({ to: "/assist" });
    else setInfo("Account created. Check your inbox to confirm your email, then sign in.");
  }

  function switchMode() {
    setMode(mode === "signin" ? "register" : "signin");
    setError(null);
    setInfo(null);
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <section className="hidden flex-col justify-between bg-primary p-10 text-primary-foreground lg:flex">
        <div className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <span className="grid size-9 place-items-center rounded-md bg-primary-foreground/15">
            <Activity className="size-5" />
          </span>
          KwikAid
        </div>
        <div className="max-w-sm space-y-4">
          <h1 className="text-3xl font-semibold leading-tight">Calm, guided first aid at the scene.</h1>
          <p className="text-sm text-primary-foreground/80">
            Photograph the injury, work through one step at a time, escalate to emergency services when severity
            demands it, and keep a clean record of every incident.
          </p>
        </div>
        <p className="flex items-center gap-2 text-xs text-primary-foreground/70">
          <ShieldCheck className="size-4" /> Demonstration build — guidance is simulated.
        </p>
      </section>

      <section className="flex items-center justify-center px-6 py-16">
        <form onSubmit={submit} className="w-full max-w-sm space-y-6">
          <div className="space-y-1.5">
            <h2 className="text-2xl font-semibold tracking-tight text-foreground">
              {mode === "signin" ? "Sign in" : "Create an account"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {mode === "signin" ? "Use your email and password." : "Passwords need at least 6 characters."}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {info && <p className="text-sm text-primary">{info}</p>}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Register"}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            {mode === "signin" ? "New to KwikAid?" : "Already have an account?"}{" "}
            <button type="button" onClick={switchMode} className="font-medium text-primary hover:underline">
              {mode === "signin" ? "Create an account" : "Sign in"}
            </button>
          </p>
        </form>
      </section>
    </div>
  );
}
