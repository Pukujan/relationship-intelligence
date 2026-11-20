/**
 * Environment validation. A missing or malformed value is reported at boot
 * with the variable name, never with its contents.
 */
import { z } from "zod";

const EnvSchema = z.object({
  OCTO_API_URL: z.string().url(),
  OCTO_API_KEY: z.string().optional(),
  // iron-session requires a password of at least 32 characters. Generated
  // once at deploy time; rotating it signs everyone out.
  SESSION_PASSWORD: z.string().min(32),
  APP_ORIGIN: z.string().url(),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export function readEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const names = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Missing or invalid environment: ${names}`);
  }
  return parsed.data;
}
