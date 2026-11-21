import { useCallback, useEffect, useState } from "react";
import { Fish, Globe, Loader2, Plug, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { SectionHeader } from "@/components/common";
import { Pill } from "@/components/work";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  deriveApiServiceChip,
  type ApiServiceView,
  type ApiServiceProvider,
} from "../../../../app/shared/contracts";

const CHIP_CLASS: Record<string, string> = {
  ok: "border-run/30 bg-run/10 text-run",
  warn: "border-warn/30 bg-warn/10 text-warn",
  error: "border-destructive/40 bg-destructive/10 text-destructive",
  muted: "border-border bg-surface-2 text-muted-foreground",
};

const api = async (path: string, method = "GET", body?: unknown) => {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.detail || json.error || res.statusText);
  return json;
};

export function ApiServicesSection() {
  const [services, setServices] = useState<ApiServiceView[]>([]);
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<ApiServiceProvider>("tinyfish");
  const [name, setName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [headers, setHeaders] = useState("");
  const [testUrl, setTestUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const j = await api("/app-api/services");
      setServices(j.services ?? []);
    } catch (e) {
      toast.error("Couldn't load API services: " + (e instanceof Error ? e.message : "unknown"));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const reset = () => {
    setName(""); setApiKey(""); setBaseUrl(""); setHeaders(""); setTestUrl("");
    setProvider("tinyfish");
  };

  const create = async () => {
    setBusy(true);
    try {
      const body =
        provider === "tinyfish"
          ? { provider, name: name || undefined, apiKey }
          : { provider, name: name || undefined, baseUrl, headers: headers ? JSON.parse(headers) : {}, testUrl };
      const j = await api("/app-api/services", "POST", body);
      const t = j.service?.lastTest;
      toast[t?.ok ? "success" : "warning"](t?.message ?? "Service attached.");
      setOpen(false); reset(); void load();
    } catch (e) {
      toast.error("Attach failed: " + (e instanceof Error ? e.message : "unknown"));
    } finally {
      setBusy(false);
    }
  };

  const test = async (s: ApiServiceView) => {
    setPendingId(s.id);
    try {
      const j = await api(`/app-api/services/${s.id}/test`, "POST");
      toast[j.test?.ok ? "success" : "error"](j.test?.message ?? "Tested.");
      void load();
    } catch (e) {
      toast.error("Test failed: " + (e instanceof Error ? e.message : "unknown"));
    } finally {
      setPendingId(null);
    }
  };

  const remove = async (s: ApiServiceView) => {
    setPendingId(s.id);
    try {
      await api(`/app-api/services/${s.id}`, "DELETE");
      toast.success("Removed " + s.name);
      void load();
    } catch (e) {
      toast.error("Remove failed: " + (e instanceof Error ? e.message : "unknown"));
    } finally {
      setPendingId(null);
    }
  };

  return (
    <section className="space-y-2.5">
      <SectionHeader
        title="API services (TinyFish & outside APIs)"
        count={services.length}
        action={
          <Button size="sm" className="h-7 gap-1 rounded-md px-2 text-[11px]" onClick={() => setOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Attach service
          </Button>
        }
      />
      <p className="text-[11.5px] leading-relaxed text-muted-foreground">
        Attach external APIs by key or header. <span className="font-medium">TinyFish</span> runs goal-based web
        automations, clean page fetches and web search; <span className="font-medium">Generic REST</span> connects any
        outside service. Keys stay on the server and are used by workflows and the copilot.
      </p>

      {services.length === 0 ? (
        <div className="panel flex items-center gap-3 p-4 text-[11.5px] text-muted-foreground">
          <Plug className="h-4 w-4 shrink-0" />
          No API services yet. Attach TinyFish (paste your X-API-Key from agent.tinyfish.ai) or any REST API.
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {services.map((s) => {
            const chip = deriveApiServiceChip(s);
            const Icon = s.provider === "tinyfish" ? Fish : Globe;
            const isBusy = pendingId === s.id;
            return (
              <article key={s.id} className="panel flex flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface-2">
                      <Icon className="h-4 w-4" />
                    </span>
                    <div>
                      <p className="text-[12.5px] font-semibold leading-tight">{s.name}</p>
                      <p className="text-[10.5px] text-muted-foreground">
                        {s.provider === "tinyfish" ? "TinyFish web agent" : "Generic REST API"}
                      </p>
                    </div>
                  </div>
                  <Pill className={CHIP_CLASS[chip.tone] ?? CHIP_CLASS.muted}>{chip.label}</Pill>
                </div>

                <p className="text-[11px] text-muted-foreground">
                  {s.provider === "tinyfish"
                    ? s.keyHint ? `Key ${s.keyHint}` : "No key set"
                    : s.baseUrl || "No base URL"}
                  {s.provider === "rest" && s.hasHeaders ? " · auth headers set" : ""}
                </p>
                {s.lastTest ? (
                  <p className={`text-[10.5px] ${s.lastTest.ok ? "text-run" : "text-destructive"}`}>
                    {s.lastTest.message}
                  </p>
                ) : null}

                <div className="mt-auto flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 rounded-md px-2 text-[11px]"
                    disabled={isBusy}
                    onClick={() => test(s)}
                  >
                    {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    Test
                  </Button>
                  <button
                    className="ml-auto rounded-md p-1.5 text-muted-foreground hover:bg-surface-2 hover:text-destructive"
                    title="Remove service"
                    disabled={isBusy}
                    onClick={() => remove(s)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Attach an API service</DialogTitle>
            <DialogDescription>
              Credentials are stored server-side and never sent back to the browser.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {(["tinyfish", "rest"] as ApiServiceProvider[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setProvider(p)}
                  className={`flex items-center gap-2 rounded-md border p-2.5 text-left text-[12px] ${
                    provider === p ? "border-primary bg-surface-2" : "border-border hover:bg-surface-2"
                  }`}
                >
                  {p === "tinyfish" ? <Fish className="h-4 w-4" /> : <Globe className="h-4 w-4" />}
                  <span>
                    <span className="block font-medium">{p === "tinyfish" ? "TinyFish" : "Generic REST"}</span>
                    <span className="block text-[10px] text-muted-foreground">
                      {p === "tinyfish" ? "Web agent · fetch · search" : "Any outside API"}
                    </span>
                  </span>
                </button>
              ))}
            </div>

            <label className="block space-y-1">
              <span className="text-[11px] font-medium text-muted-foreground">Display name</span>
              <input
                className="h-8 w-full rounded-md border border-border bg-surface-2 px-2.5 text-[12px]"
                value={name}
                placeholder={provider === "tinyfish" ? "TinyFish Web Agent" : "My service API"}
                onChange={(e) => setName(e.target.value)}
              />
            </label>

            {provider === "tinyfish" ? (
              <label className="block space-y-1">
                <span className="text-[11px] font-medium text-muted-foreground">API key (X-API-Key)</span>
                <input
                  type="password"
                  className="h-8 w-full rounded-md border border-border bg-surface-2 px-2.5 text-[12px]"
                  value={apiKey}
                  placeholder="from agent.tinyfish.ai → API Keys"
                  onChange={(e) => setApiKey(e.target.value)}
                />
                <span className="block text-[10px] text-muted-foreground">
                  The connection test reads your wallet balance (no run cost).
                </span>
              </label>
            ) : (
              <>
                <label className="block space-y-1">
                  <span className="text-[11px] font-medium text-muted-foreground">Base URL</span>
                  <input
                    className="h-8 w-full rounded-md border border-border bg-surface-2 px-2.5 text-[12px]"
                    value={baseUrl}
                    placeholder="https://api.service.com/v1"
                    onChange={(e) => setBaseUrl(e.target.value)}
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-[11px] font-medium text-muted-foreground">Default headers (JSON)</span>
                  <textarea
                    className="w-full rounded-md border border-border bg-surface-2 px-2.5 py-1.5 font-mono text-[11px]"
                    rows={2}
                    value={headers}
                    placeholder={'{"Authorization": "Bearer TOKEN"}'}
                    onChange={(e) => setHeaders(e.target.value)}
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-[11px] font-medium text-muted-foreground">Test URL (optional)</span>
                  <input
                    className="h-8 w-full rounded-md border border-border bg-surface-2 px-2.5 text-[12px]"
                    value={testUrl}
                    placeholder="https://api.service.com/v1/status"
                    onChange={(e) => setTestUrl(e.target.value)}
                  />
                </label>
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              size="sm"
              disabled={busy || (provider === "tinyfish" ? !apiKey.trim() : !baseUrl.trim())}
              onClick={create}
            >
              {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              Attach & test
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
