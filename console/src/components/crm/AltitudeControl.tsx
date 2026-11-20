import { useCallback, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Layered reading altitudes for the CRM surfaces.
 *
 * Glance is the default everywhere: signals and headlines first, detail on
 * demand. The choice is persisted per view in sessionStorage (a UI preference
 * for this tab only — never user data, never sent anywhere), so raising the
 * altitude on Projects does not change Today.
 */

export type Altitude = "glance" | "brief" | "deep";

export const ALTITUDES: { id: Altitude; label: string; hint: string }[] = [
  { id: "glance", label: "Glance", hint: "Signals and headlines only." },
  { id: "brief", label: "Brief", hint: "The working view — rows, lists, actions." },
  { id: "deep", label: "Deep", hint: "Everything: evidence, activity, steps." },
];

const storageKey = (view: string) => `mission-control.altitude.v1.${view}`;

const readAltitude = (view: string): Altitude => {
  try {
    const raw = window.sessionStorage.getItem(storageKey(view));
    return raw === "brief" || raw === "deep" ? raw : "glance";
  } catch {
    // A blocked storage API must never break the view — fall back to Glance.
    return "glance";
  }
};

/** Per-view altitude state, persisted for the tab session. Default: Glance. */
export const useAltitude = (view: string) => {
  const [altitude, setAltitudeState] = useState<Altitude>(() => readAltitude(view));
  const setAltitude = useCallback(
    (next: Altitude) => {
      setAltitudeState(next);
      try {
        window.sessionStorage.setItem(storageKey(view), next);
      } catch {
        // Preference-only; ignore storage failures.
      }
    },
    [view],
  );
  return [altitude, setAltitude] as const;
};

/**
 * Segmented Glance / Brief / Deep switch. Uncontrolled by default (persists
 * under `view`); pass `value` + `onChange` to drive it locally — Peek does
 * this because its altitude lives inside the sheet, not on the page.
 */
export const AltitudeControl = ({
  view,
  value,
  onChange,
  options,
  className,
}: {
  view: string;
  value?: Altitude;
  onChange?: (next: Altitude) => void;
  options?: Altitude[];
  className?: string;
}) => {
  const [stored, setStored] = useAltitude(view);
  const current = value ?? stored;
  const change = onChange ?? setStored;
  const ids = options ?? ALTITUDES.map((item) => item.id);
  return (
    <div
      className={cn(
        "flex items-center gap-0.5 rounded-lg border border-border/70 bg-surface-1 p-0.5",
        className,
      )}
      role="group"
      aria-label="Reading altitude"
    >
      {ALTITUDES.filter((item) => ids.includes(item.id)).map((item) => (
        <button
          key={item.id}
          type="button"
          title={item.hint}
          aria-pressed={current === item.id}
          onClick={() => change(item.id)}
          className={cn(
            "focus-ring rounded-md px-2.5 py-1 text-[11.5px] font-medium transition-colors",
            current === item.id
              ? "bg-surface-3 text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
};
