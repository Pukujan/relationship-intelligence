import { MousePointer2 } from "lucide-react";
import { useAgentCursor } from "./agentCursor";

/**
 * Floating visual cursor rendered above the console while the voice/chat
 * assistant navigates or clicks controls on the user's behalf.
 */
export const AgentCursorOverlay = () => {
  const { visible, x, y, clicking, caption } = useAgentCursor();

  if (!visible) return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[70] overflow-hidden"
    >
      <div
        className="absolute left-0 top-0 will-change-transform"
        style={{
          transform: `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`,
          transition: "transform 560ms cubic-bezier(0.2, 0.7, 0.1, 1)",
        }}
      >
        {/* Click ripple */}
        {clicking ? (
          <span className="absolute -left-4 -top-4 h-9 w-9 animate-ping rounded-full border-2 border-primary bg-primary/20" />
        ) : null}

        {/* Pointer glyph */}
        <div
          className="relative flex items-center gap-1.5"
          style={{
            transform: clicking ? "scale(0.88)" : "scale(1)",
            transition: "transform 160ms ease",
          }}
        >
          <span className="flex h-7 w-7 -translate-x-1 -translate-y-1 items-center justify-center rounded-full border border-primary/60 bg-primary text-primary-foreground shadow-[0_6px_24px_rgba(0,0,0,0.45)]">
            <MousePointer2 className="h-3.5 w-3.5 fill-current" />
          </span>

          {caption ? (
            <span className="max-w-[220px] truncate rounded-full border border-primary/35 bg-background/95 px-2.5 py-1 text-[11px] font-medium text-foreground shadow-lg backdrop-blur-md">
              {caption}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
};
