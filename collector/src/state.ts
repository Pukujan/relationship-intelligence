/**
 * Daemon local state (SDD §4, R5).
 *
 * RI_DAEMON_ROOT defaults to ~/.cache/ri-daemon and is created 0700.
 * device.json is written 0600 and holds the device token plus the local
 * Riley secret. Both never leave the machine; nothing here is ever sent to
 * the server except the bearer token on device routes.
 */
import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DeviceStateSchema, type DeviceState } from "./contracts.js";

export function daemonRoot(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.RI_DAEMON_ROOT;
  if (override && override.trim().length > 0) return override;
  return path.join(os.homedir(), ".cache", "ri-daemon");
}

/** Create (or tighten) the daemon root at 0700. */
export function ensureRoot(root: string): string {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  chmodSync(root, 0o700);
  return root;
}

export function devicePath(root: string): string {
  return path.join(root, "device.json");
}

/** Load and Zod-validate device.json; null when unpaired. */
export function loadDevice(root: string): DeviceState | null {
  const file = devicePath(root);
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`device.json at ${file} is not valid JSON. Re-pair: pnpm run daemon -- pair --code <CODE> --server <URL>`);
  }
  const result = DeviceStateSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`device.json at ${file} failed validation. Re-pair: pnpm run daemon -- pair --code <CODE> --server <URL>`);
  }
  return result.data;
}

/** Atomically persist device.json at 0600 under a 0700 root. */
export function saveDevice(root: string, state: DeviceState): string {
  const validated = DeviceStateSchema.parse(state);
  ensureRoot(root);
  const file = devicePath(root);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(validated, null, 2)}\n`, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
  chmodSync(file, 0o600);
  return file;
}

/** R5: per-install secret for the loopback Riley endpoint. */
export function newLocalSecret(): string {
  return randomBytes(32).toString("hex");
}

export function evidenceDir(root: string): string {
  const dir = path.join(root, "evidence");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  return dir;
}

/** Derived-signal evidence only: never cookies, tokens, or raw browser state. */
export function writeEvidence(root: string, name: string, value: unknown): string {
  const dir = evidenceDir(root);
  const file = path.join(dir, name);
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  return file;
}

/** Octal permission bits of a path (for tests and status diagnostics). */
export function modeOf(p: string): number {
  return statSync(p).mode & 0o777;
}
