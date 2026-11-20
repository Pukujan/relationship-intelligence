import { useEffect, useState } from "react";
import { TimerReset } from "lucide-react";
import { cn } from "@/lib/utils";
import { useData } from "@/data/store";

/**
 * Session countdown chip. Octo tokens carry a 20-minute absolute TTL and our
 * cookie adds a 30-minute sliding idle window; this chip makes the remaining
 * time legible and offers one-click resume before the user is bounced.
 */
export const SessionChip = () => {
  const { session, sessionExpiresAt, resumeSession } = useData();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  if (!session || session.mode !== "owner" || !sessionExpiresAt) return null;
  const minutes = Math.max(0, Math.round((sessionExpiresAt - now) / 60_000));
  const low = minutes <= 5;

  return (
    <button
      type="button"
      onClick={resumeSession}
      title="Octo session time left. Click to resume with one consent click."
      className={cn(
        "focus-ring hidden items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px] font-medium sm:inline-flex",
        low
          ? "border-warn/40 bg-warn/10 text-warn"
          : "border-border/70 bg-surface-1 text-muted-foreground",
      )}
    >
      <TimerReset className="h-3 w-3" />
      {minutes}m session
    </button>
  );
};
