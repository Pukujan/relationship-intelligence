import { useCallback, useEffect, useState } from "react";
import { Link2, MessageSquareText } from "lucide-react";
import { toast } from "sonner";
import { useData } from "@/data/store";
import { suggestContact } from "@/lib/suggestContact";
import { Button } from "@/components/ui/button";

/**
 * Conversations to match (#120): DM threads the import couldn't attach to a
 * contact, because nothing links that account to anyone yet. The owner picks
 * the contact once; the account is recorded on them and later messages attach
 * by themselves. A name match is only ever a suggestion; nothing links
 * without a click.
 */

interface Conversation {
  channel: "linkedin" | "telegram" | "whatsapp" | "discord";
  threadId: string;
  threadUrl: string | null;
  name: string;
  handle: string | null;
  messages: number;
  lastAt: string;
}

const CHANNEL_LABEL: Record<Conversation["channel"], string> = {
  linkedin: "LinkedIn",
  telegram: "Telegram",
  whatsapp: "WhatsApp",
  discord: "Discord",
};

const ConversationsToMatch = () => {
  const { session, world, reload } = useData();
  const [items, setItems] = useState<Conversation[]>([]);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const workspaceId = session?.mode === "owner" ? session.workspaceId : null;

  const load = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const r = await fetch(
        `/app-api/dm/conversations?workspaceId=${encodeURIComponent(workspaceId)}`,
        { credentials: "same-origin" },
      );
      if (!r.ok) return;
      const data = (await r.json()) as { conversations?: Conversation[] };
      setItems(data.conversations ?? []);
    } catch {
      // Not available (e.g. not the owner): the card simply stays hidden.
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!workspaceId || !world || items.length === 0) return null;
  const people = [...world.people].sort((a, b) => a.name.localeCompare(b.name));

  const link = async (item: Conversation, personId: string) => {
    const key = `${item.channel}:${item.threadId}`;
    setBusy(key);
    try {
      const r = await fetch("/app-api/dm/link", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          channel: item.channel,
          threadId: item.threadId,
          personId,
        }),
      });
      if (!r.ok) throw new Error(String(r.status));
      const person = people.find((p) => p.id === personId);
      toast.success(`Linked to ${person?.name ?? "contact"}`, {
        description: `Future ${CHANNEL_LABEL[item.channel]} messages with them attach by themselves.`,
      });
      setItems((list) =>
        list.filter((c) => !(c.channel === item.channel && c.threadId === item.threadId)),
      );
      reload();
    } catch {
      toast.error("Couldn't link that conversation", { description: "Try again in a moment." });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="panel p-4" aria-label="Conversations to match">
      <div className="flex items-center gap-2">
        <MessageSquareText className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-[13px] font-semibold">Conversations to match</h2>
        <span className="num rounded-full border border-border/70 bg-surface-2 px-1.5 py-px text-[10px] text-muted-foreground">
          {items.length}
        </span>
      </div>
      <p className="mt-1 text-[11.5px] text-muted-foreground">
        These chats aren't linked to anyone yet. Pick the contact once and later messages attach by
        themselves. Only you see this.
      </p>
      <ul className="mt-3 divide-y divide-border/60">
        {items.slice(0, 20).map((item) => {
          const key = `${item.channel}:${item.threadId}`;
          const suggested = suggestContact(item.name, people);
          const selected = choice[key] ?? suggested;
          return (
            <li key={key} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] font-medium">
                  {item.name || item.handle || "Unknown"}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {CHANNEL_LABEL[item.channel]} · {item.messages} message
                  {item.messages === 1 ? "" : "s"} · last{" "}
                  {new Date(item.lastAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  {selected && selected === suggested ? " · suggested by name, check before linking" : ""}
                </p>
              </div>
              <select
                aria-label={`Contact for ${item.name}`}
                className="focus-ring h-8 max-w-[220px] rounded-md border border-border bg-background px-2 text-[12px]"
                value={selected}
                onChange={(event) => setChoice((c) => ({ ...c, [key]: event.target.value }))}
              >
                <option value="">Choose a contact…</option>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 rounded-md text-[12px]"
                disabled={!selected || busy === key}
                onClick={() => void link(item, selected)}
              >
                <Link2 className="h-3.5 w-3.5" />
                Link
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
};

export default ConversationsToMatch;
