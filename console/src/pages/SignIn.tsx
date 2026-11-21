import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Check,
  Command,
  Loader2,
  Lock,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useData } from "@/data/store";
import { Button } from "@/components/ui/button";

const GoogleMark = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
    <path
      fill="#4285F4"
      d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.47a5.53 5.53 0 0 1-2.4 3.63v3h3.87c2.26-2.09 3.55-5.17 3.55-8.87Z"
    />
    <path
      fill="#34A853"
      d="M12 24c3.24 0 5.95-1.08 7.94-2.91l-3.87-3c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.28v3.1A11.99 11.99 0 0 0 12 24Z"
    />
    <path
      fill="#FBBC05"
      d="M5.27 14.28a7.2 7.2 0 0 1 0-4.56v-3.1H1.28a12 12 0 0 0 0 10.76l3.99-3.1Z"
    />
    <path
      fill="#EA4335"
      d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.43-3.43C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.69 1.28 6.62l3.99 3.1C6.22 6.86 8.87 4.75 12 4.75Z"
    />
  </svg>
);

const proof = [
  {
    icon: Sparkles,
    title: "Agents that work the graph",
    detail: "Sales, marketing, and research agents draft, research, and queue the work.",
  },
  {
    icon: ShieldCheck,
    title: "Nothing sends without you",
    detail: "Every send, call, publish, and invite lands in one approval inbox.",
  },
  {
    icon: Lock,
    title: "Your workspace, your record",
    detail: "People, claims, and evidence stay in your Octo workspace.",
  },
];

const SignIn = () => {
  const { session, signIn, sessionReason, resumeSession, connectWithKey } = useData();
  const [key, setKey] = useState("");
  const [keyBusy, setKeyBusy] = useState(false);
  const navigate = useNavigate();
  const [pending, setPending] = useState<"google" | "guest" | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (session) {
    return <Navigate to="/today" replace />;
  }

  const enter = async (mode: "google" | "guest") => {
    setPending(mode);
    setError(null);
    try {
      const next = await signIn(mode === "google" ? "owner" : "guest");
      toast.success(
        next.mode === "guest" ? "You're in the demo workspace" : "Signed in",
        {
          description:
            next.mode === "guest"
              ? "Seeded data only — decisions reset when you reload."
              : "Your Octo workspaces loaded.",
        },
      );
      navigate("/today", { replace: true });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Sign-in didn't complete. Please try again.",
      );
      setPending(null);
    }
  };

  return (
    <div className="grid-warm relative min-h-screen overflow-hidden bg-background">
      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-5 py-8 sm:px-8">
        <header className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-[10px] border border-primary/30 bg-primary/10 text-primary">
            <Command className="h-4 w-4" strokeWidth={2} />
          </span>
          <div className="leading-none">
            <p className="text-[13px] font-semibold tracking-[0.01em]">
              Mission Control
            </p>
            <p className="mt-1 text-[10.5px] text-muted-foreground">
              by Fieldstone
            </p>
          </div>
        </header>

        <div className="grid flex-1 items-center gap-10 py-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.92fr)] lg:gap-14 lg:py-14">
          <div className="animate-rise">
            <p className="eyebrow">Relationship workspace</p>
            <h1 className="mt-3 text-balance text-[32px] font-semibold leading-[1.1] sm:text-[40px]">
              The relationships your team is working,
              <span className="text-muted-foreground"> with the work that moves them.</span>
            </h1>
            <p className="mt-4 max-w-md text-[13.5px] leading-relaxed text-muted-foreground">
              Mission Control turns your people graph into projects, objectives,
              and milestones your agents can execute — and keeps every outbound
              move behind your approval.
            </p>

            <div className="mt-7 max-w-sm space-y-2.5">
              <Button
                type="button"
                size="lg"
                className="h-11 w-full justify-center gap-2.5 rounded-xl text-[13px]"
                disabled={pending !== null}
                onClick={() => void enter("google")}
              >
                {pending === "google" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <GoogleMark />
                )}
                Continue with Google
              </Button>
              <Button
                type="button"
                size="lg"
                variant="outline"
                className="h-11 w-full justify-center gap-2 rounded-xl border-border/80 bg-surface-1/60 text-[13px]"
                disabled={pending !== null}
                onClick={() => void enter("guest")}
              >
                {pending === "guest" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ArrowRight className="h-4 w-4" />
                )}
                Continue as guest
                <span className="ml-1 rounded-full border border-warn/30 bg-warn/10 px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-[0.08em] text-warn">
                  demo
                </span>
              </Button>
              {sessionReason === "octo_token_expired" || sessionReason === "idle_expired" ? (
                <div className="mb-3 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-[12px] text-warn">
                  {sessionReason === "idle_expired"
                    ? "You were idle past the 30-minute window, so the local session ended."
                    : "Your Octo session reached its 20-minute platform limit."}{" "}
                  Resume with one click — Google remembers you, so it is a single consent tap.
                  <button
                    type="button"
                    onClick={resumeSession}
                    className="focus-ring ml-2 rounded-md border border-warn/40 px-2 py-0.5 text-[11px] font-medium hover:bg-warn/10"
                  >
                    Resume session
                  </button>
                </div>
              ) : null}
              <div className="mb-3 rounded-lg border border-border/70 bg-surface-1/60 px-3 py-2">
                <p className="text-[11.5px] text-muted-foreground">
                  No redirect loop: paste a workspace key from Octo → Keys and connect directly.
                  Google sign-in may land you on the Octo portal; this path never leaves the console.
                </p>
                <div className="mt-2 flex gap-2">
                  <input
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    type="password"
                    placeholder="octo_live_ws_…"
                    aria-label="Workspace key"
                    className="h-8 min-w-0 flex-1 rounded-md border border-border/70 bg-surface-1 px-2 text-[12px] outline-none"
                  />
                  <button
                    type="button"
                    disabled={keyBusy || !key.trim()}
                    onClick={() => {
                      setKeyBusy(true);
                      connectWithKey(key.trim()).catch((e) => {
                        setError(e instanceof Error ? e.message : "Could not connect.");
                        setKeyBusy(false);
                      });
                    }}
                    className="focus-ring h-8 rounded-md border border-primary/40 bg-primary/10 px-3 text-[11.5px] font-medium text-primary"
                  >
                    {keyBusy ? "Connecting…" : "Connect with key"}
                  </button>
                </div>
              </div>
              {error ? (
                <p role="alert" className="text-[11.5px] text-destructive">
                  {error}
                </p>
              ) : null}
              <p className="pt-1 text-[11px] leading-relaxed text-muted-foreground">
                Guest mode opens the seeded Fieldstone workspace — no account, no
                email. Your data stays in your own workspace when you sign in.
              </p>
            </div>
          </div>

          <div className="space-y-2.5">
            {proof.map((item, index) => (
              <div
                key={item.title}
                className={cn(
                  "panel flex items-start gap-3 p-3.5",
                  index === 0 && "animate-rise",
                )}
                style={{ animationDelay: `${index * 70}ms` }}
              >
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-surface-2 text-muted-foreground">
                  <item.icon className="h-3.5 w-3.5" />
                </span>
                <div>
                  <p className="text-[12.5px] font-medium">{item.title}</p>
                  <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
                    {item.detail}
                  </p>
                </div>
              </div>
            ))}

            <div className="rounded-xl border border-border/60 bg-surface-1/40 p-3.5">
              <p className="eyebrow">What you'll land on</p>
              <div className="mt-2 space-y-1.5">
                {[
                  "3 projects · 6 objectives · 9 milestones in motion",
                  "8 decisions waiting in the approval inbox",
                  "18 people, 6 companies, 6 events in the graph",
                ].map((line) => (
                  <p
                    key={line}
                    className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
                  >
                    <Check className="h-3 w-3 shrink-0 text-run" />
                    {line}
                  </p>
                ))}
              </div>
            </div>
          </div>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-4 text-[10.5px] text-muted-foreground">
          <span>
            Octo workspace · evidence-backed. Nothing unsourced becomes a fact.
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="kbd">⌘</kbd>
            <kbd className="kbd">K</kbd>
            opens the copilot once you're in
          </span>
        </footer>
      </div>
    </div>
  );
};

export default SignIn;
