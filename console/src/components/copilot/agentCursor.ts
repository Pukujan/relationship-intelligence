/**
 * Animated agent cursor & safe UI actuation (inspired by design-bakery's agentCursor.ts).
 *
 * When the voice or floating-dock copilot decides to navigate, click a safe tab/button,
 * or spotlight a section on screen, this controller glides a visible pointer + caption
 * to the matching DOM element, triggers a press ripple, and performs the action.
 *
 * Safety rule (PROJECT.md): destructive or outbound approval controls (Approve, Decline,
 * Delete, Send, Publish, Sign out) are never auto-clicked programmatically.
 */
import { useSyncExternalStore } from "react";
import type { NavigateFunction } from "react-router-dom";
import type { VoiceAction } from "@/lib/voiceClient";

export interface AgentCursorState {
  visible: boolean;
  x: number;
  y: number;
  clicking: boolean;
  caption: string;
}

let state: AgentCursorState = {
  visible: false,
  x: -80,
  y: -80,
  clicking: false,
  caption: "",
};

const listeners = new Set<() => void>();
let hideTimer: ReturnType<typeof setTimeout> | undefined;
let clickTimer: ReturnType<typeof setTimeout> | undefined;

const set = (patch: Partial<AgentCursorState>) => {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
};

const wait = (ms: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, ms));

export const useAgentCursor = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
    () => state,
  );

const BLOCKED_CLICK_RE =
  /\b(approve|decline|reject|delete|remove|destroy|revoke|sign out|logout|log out|send|publish|reset)\b/i;

function isElementVisible(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const style = window.getComputedStyle(el);
  return style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
}

function centerOf(el: Element): { x: number; y: number } {
  const rect = el.getBoundingClientRect();
  const top = Math.max(rect.top, 64);
  const bottom = Math.min(rect.bottom, window.innerHeight - 40);
  const y = top < bottom ? (top + bottom) / 2 : rect.top + rect.height / 2;
  return {
    x: Math.max(24, Math.min(window.innerWidth - 24, rect.left + rect.width / 2)),
    y: Math.max(24, Math.min(window.innerHeight - 24, y)),
  };
}

function findLinkForPath(path: string): HTMLElement | null {
  const clean = path.replace(/"/g, "");
  const candidates = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"));
  for (const link of candidates) {
    if (!isElementVisible(link)) continue;
    const href = link.getAttribute("href") ?? "";
    if (href === clean || href === `/console${clean}` || href.endsWith(clean)) {
      return link;
    }
  }
  return null;
}

function findControlByLabel(label: string): HTMLElement | null {
  const needle = label.trim().toLowerCase();
  if (!needle) return null;
  const nodes = Array.from(
    document.querySelectorAll<HTMLElement>(
      "button, a[href], [role='tab'], [role='button'], [role='menuitem']",
    ),
  ).filter((el) => !el.closest("[data-copilot-dock]") && isElementVisible(el));

  // Prefer exact match first, then substring match.
  const textOf = (el: HTMLElement) =>
    (el.getAttribute("aria-label") || el.innerText || el.textContent || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();

  return (
    nodes.find((el) => textOf(el) === needle) ??
    nodes.find((el) => textOf(el).includes(needle)) ??
    null
  );
}

function findSectionByLabel(label: string): HTMLElement | null {
  const needle = label.trim().toLowerCase();
  if (!needle) return null;
  const nodes = Array.from(
    document.querySelectorAll<HTMLElement>("h1, h2, h3, [data-spotlight], section, article"),
  ).filter((el) => !el.closest("[data-copilot-dock]") && isElementVisible(el));

  return (
    nodes.find((el) =>
      (el.innerText || el.textContent || "").toLowerCase().includes(needle),
    ) ?? null
  );
}

function pulseHighlight(el: HTMLElement) {
  const prevOutline = el.style.outline;
  const prevOffset = el.style.outlineOffset;
  el.style.outline = "2px solid hsl(var(--primary))";
  el.style.outlineOffset = "3px";
  window.setTimeout(() => {
    el.style.outline = prevOutline;
    el.style.outlineOffset = prevOffset;
  }, 1600);
}

function scheduleHide(ms = 1400) {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    set({ visible: false, clicking: false, caption: "" });
  }, ms);
}

async function glideTo(point: { x: number; y: number }, caption: string) {
  clearTimeout(hideTimer);
  if (!state.visible) {
    // Enter smoothly from bottom-right near the dock.
    set({
      visible: true,
      x: Math.max(40, window.innerWidth - 96),
      y: Math.max(40, window.innerHeight - 96),
      caption,
      clicking: false,
    });
    await wait(30);
  }
  set({ visible: true, x: point.x, y: point.y, caption });
  await wait(580);
}

async function pressClick() {
  clearTimeout(clickTimer);
  set({ clicking: true });
  await wait(240);
  clickTimer = setTimeout(() => set({ clicking: false }), 160);
}

/** Collect visible safe interactive labels on the current screen for /api/voice context. */
export function collectScreenTargets(): string[] {
  if (typeof document === "undefined") return [];
  const seen = new Set<string>();
  const targets: string[] = [];
  const nodes = document.querySelectorAll<HTMLElement>(
    "main button, main a[href], main [role='tab'], nav a[href]",
  );
  for (const el of nodes) {
    if (el.closest("[data-copilot-dock]") || !isElementVisible(el)) continue;
    const raw = (el.getAttribute("aria-label") || el.innerText || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!raw || raw.length > 60) continue;
    if (BLOCKED_CLICK_RE.test(raw)) continue;
    const key = raw.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push(raw);
    if (targets.length >= 28) break;
  }
  return targets;
}

export const agentCursor = {
  async runActions(actions: VoiceAction[], navigate: NavigateFunction) {
    for (const action of actions) {
      if (action.type === "navigate") {
        const caption = action.label || `Opening ${action.to}`;
        const link = findLinkForPath(action.to);
        if (link) {
          link.scrollIntoView({ block: "nearest", behavior: "smooth" });
          await glideTo(centerOf(link), caption);
          pulseHighlight(link);
          await pressClick();
        } else {
          await glideTo(
            { x: window.innerWidth * 0.5, y: window.innerHeight * 0.32 },
            caption,
          );
          await pressClick();
        }
        navigate(action.to);
        await wait(280);
      } else if (action.type === "click") {
        if (BLOCKED_CLICK_RE.test(action.target)) continue;
        const target = findControlByLabel(action.target);
        if (!target) continue;
        const actualLabel = (
          target.getAttribute("aria-label") ||
          target.innerText ||
          ""
        ).trim();
        if (BLOCKED_CLICK_RE.test(actualLabel)) continue;
        target.scrollIntoView({ block: "center", behavior: "smooth" });
        await wait(120);
        await glideTo(centerOf(target), action.label || `Clicking ${action.target}`);
        pulseHighlight(target);
        await pressClick();
        target.click();
        await wait(240);
      } else if (action.type === "spotlight") {
        const target = findSectionByLabel(action.target);
        if (!target) continue;
        target.scrollIntoView({ block: "center", behavior: "smooth" });
        await wait(160);
        await glideTo(centerOf(target), action.label || action.target);
        pulseHighlight(target);
        await wait(500);
      }
    }
    if (actions.length > 0) scheduleHide(1200);
  },

  hide() {
    clearTimeout(hideTimer);
    set({ visible: false, clicking: false, caption: "" });
  },
};
