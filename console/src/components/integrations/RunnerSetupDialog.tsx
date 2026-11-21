/**
 * RI-0021: setup flow for local_runner connectors. Pairing code is shown once
 * at generation; consent toggles gate collection; devices can be revoked.
 * No device token or hash is ever rendered (R8).
 */
import { useCallback, useEffect, useState } from "react";
import { Copy, Loader2, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

interface RunnerSetupData {
  installCommand: string;
  pairCommand: string;
  devices: { id: string; label: string; lastSeenAt: string; pairingStatus: string }[];
  consents: { provider: string; scopes: string[]; granted: boolean }[];
}

const SCOPE_HELP: Record<string, string> = {
  "profile:read": "Read your own profile and connection signals.",
  "messages:read": "Read DM thread titles. Never sends messages.",
  "events:read": "Read your own event pages.",
  "rsvp:consent": "Stage RSVP proposals for your approval. Never auto-RSVPs.",
  "dictation:ingest": "Ingest dictation notes you export yourself.",
  "voice:brief": "Receive daily-brief events from your local voice agent.",
  "voice:triage": "Receive approval-triage events from your local voice agent.",
};

export function RunnerSetupDialog(props: {
  provider: string;
  name: string;
  scopes: string[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const { provider, name, scopes, onClose, onChanged } = props;
  const [setup, setSetup] = useState<RunnerSetupData | null>(null);
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [consented, setConsented] = useState<string[]>([]);

  const load = useCallback(async () => {
    const r = await fetch("/app-api/connectors/runner/setup", { credentials: "same-origin" });
    if (!r.ok) return;
    const data = (await r.json()) as RunnerSetupData;
    setSetup(data);
    const mine = data.consents.find((c) => c.provider === provider && c.granted);
    setConsented(mine?.scopes ?? []);
  }, [provider]);

  useEffect(() => {
    void load();
  }, [load]);

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    toast.success("Copied");
  };

  const generate = async () => {
    setBusy("pair");
    try {
      const r = await fetch("/app-api/connectors/runner/pair", { method: "POST", credentials: "same-origin" });
      if (!r.ok) throw new Error("pair failed");
      setCode((await r.json()) as { code: string; expiresAt: string });
    } catch {
      toast.error("Could not generate a pairing code");
    } finally {
      setBusy(null);
    }
  };

  const toggleScope = async (scope: string) => {
    const next = consented.includes(scope) ? consented.filter((s) => s !== scope) : [...consented, scope];
    setBusy(scope);
    try {
      const r = await fetch("/app-api/connectors/runner/consent", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, scopes: next, granted: next.length > 0 }),
      });
      if (!r.ok) throw new Error("consent failed");
      setConsented(next);
      onChanged();
    } catch {
      toast.error("Could not update consent");
    } finally {
      setBusy(null);
    }
  };

  const revoke = async (deviceId: string) => {
    setBusy(deviceId);
    try {
      await fetch("/app-api/connectors/runner/revoke", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId }),
      });
      await load();
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-label={`Set up ${name}`}>
      <div className="panel max-h-[85vh] w-full max-w-lg space-y-4 overflow-y-auto p-5">
        <div className="flex items-center justify-between">
          <p className="text-[14px] font-semibold">Set up {name}</p>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <section className="space-y-1.5">
          <p className="text-[12px] font-semibold">1 · Install the runner on your machine</p>
          <div className="flex items-center gap-1.5 rounded-md border border-border/60 bg-surface-2/60 px-2 py-1.5">
            <code className="flex-1 truncate font-mono text-[10px] text-muted-foreground">{setup?.installCommand ?? "…"}</code>
            <button type="button" onClick={() => void copy(setup?.installCommand ?? "")} aria-label="Copy install command"><Copy className="h-3 w-3" /></button>
          </div>
          <div className="flex items-center gap-1.5 rounded-md border border-border/60 bg-surface-2/60 px-2 py-1.5">
            <code className="flex-1 truncate font-mono text-[10px] text-muted-foreground">{setup?.pairCommand ?? "…"}</code>
            <button type="button" onClick={() => void copy(setup?.pairCommand ?? "")} aria-label="Copy pair command"><Copy className="h-3 w-3" /></button>
          </div>
          <p className="text-[10.5px] text-muted-foreground">The runner keeps your browser session on your machine. Cookies never reach the server.</p>
        </section>

        <section className="space-y-1.5">
          <p className="text-[12px] font-semibold">2 · Pair this device</p>
          {code ? (
            <div className="rounded-md border border-primary/30 bg-primary/10 px-3 py-2">
              <p className="font-mono text-[16px] tracking-widest text-primary">{code.code}</p>
              <p className="text-[10.5px] text-muted-foreground">Shown once. Enter it in the daemon within 10 minutes.</p>
            </div>
          ) : (
            <Button size="sm" className="h-7 text-[11px]" disabled={busy === "pair"} onClick={() => void generate()}>
              {busy === "pair" ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              Generate pairing code
            </Button>
          )}
        </section>

        <section className="space-y-1.5">
          <p className="flex items-center gap-1.5 text-[12px] font-semibold">
            <ShieldCheck className="h-3.5 w-3.5 text-run" /> 3 · Consent to collection
          </p>
          {scopes.map((scope) => (
            <label key={scope} className="flex items-start gap-2 rounded-md border border-border/50 px-2 py-1.5">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={consented.includes(scope)}
                disabled={busy === scope}
                onChange={() => void toggleScope(scope)}
              />
              <span>
                <span className="font-mono text-[10.5px]">{scope}</span>
                <span className="block text-[10.5px] text-muted-foreground">{SCOPE_HELP[scope] ?? "Scoped, consent-gated collection."}</span>
              </span>
            </label>
          ))}
        </section>

        <section className="space-y-1.5">
          <div className="flex items-center justify-between">
            <p className="text-[12px] font-semibold">4 · Paired devices</p>
            <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => void load()}>
              Refresh
            </Button>
          </div>
          {(setup?.devices ?? []).length === 0 ? (
            <p className="text-[10.5px] text-muted-foreground">No paired devices yet.</p>
          ) : (
            (setup?.devices ?? []).map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-2 rounded-md border border-border/50 px-2 py-1.5 text-[11px]">
                <span>{d.label}</span>
                <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" disabled={busy === d.id} onClick={() => void revoke(d.id)}>
                  Revoke
                </Button>
              </div>
            ))
          )}
        </section>
      </div>
    </div>
  );
}
