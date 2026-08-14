import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { Activity, LogOut } from "lucide-react";
import { currentUser, signOut } from "@/lib/firstaid";
import { Button } from "@/components/ui/button";

export function AppFrame({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!currentUser()) navigate({ to: "/", replace: true });
    else setReady(true);
  }, [navigate]);

  if (!ready) return <div className="min-h-screen bg-background" />;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center gap-4 px-4 py-3">
          <Link to="/assist" className="flex items-center gap-2 font-semibold tracking-tight text-primary">
            <span className="grid size-8 place-items-center rounded-md bg-primary text-primary-foreground">
              <Activity className="size-4" />
            </span>
            KwikAid
          </Link>
          <nav className="ml-auto flex items-center gap-1 text-sm">
            <Link
              to="/assist"
              className="rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              activeProps={{ className: "rounded-md px-3 py-1.5 bg-accent text-accent-foreground font-medium" }}
            >
              Assist
            </Link>
            <Link
              to="/incidents"
              className="rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              activeProps={{ className: "rounded-md px-3 py-1.5 bg-accent text-accent-foreground font-medium" }}
            >
              Incidents
            </Link>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                signOut();
                navigate({ to: "/", replace: true });
              }}
            >
              <LogOut className="size-4" />
              Sign out
            </Button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-8">{children}</main>
      <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">
        Demo only — simulated guidance. In a real emergency call your local emergency number.
      </footer>
    </div>
  );
}
