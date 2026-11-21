/**
 * Environment validation. A missing or malformed value is reported at boot
 * with the variable name, never with its contents.
 */
import { z } from "zod";

const EnvSchema = z.object({
  OCTO_API_URL: z.string().url(),
  OCTO_API_KEY: z.string().optional(),
  OCTO_WORKSPACE_ID: z.string().optional(),
  // iron-session requires a password of at least 32 characters. Generated
  // once at deploy time; rotating it signs everyone out.
  SESSION_PASSWORD: z.string().min(32),
  APP_ORIGIN: z.string().url(),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  ZOOM_CLIENT_ID: z.string().optional(),
  ZOOM_CLIENT_SECRET: z.string().optional(),
  SLACK_CLIENT_ID: z.string().optional(),
  SLACK_CLIENT_SECRET: z.string().optional(),
  CALENDLY_CLIENT_ID: z.string().optional(),
  CALENDLY_CLIENT_SECRET: z.string().optional(),
  DISCORD_CLIENT_ID: z.string().optional(),
  DISCORD_CLIENT_SECRET: z.string().optional(),
  // Test hooks (RI-0021 R21): honored only outside production.
  RI_OAUTH_ENDPOINTS_JSON: z.string().optional(),
  RI_RUNNER_ONLINE_WINDOW_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(600_000)
    .default(90_000),
  PHOENIX_COLLECTOR_ENDPOINT: z.string().url().optional(),
  PHOENIX_UI_URL: z.string().url().optional(),
  PHOENIX_PROJECT_NAME: z.string().optional(),
  PHOENIX_CAPTURE_CONTENT: z.string().optional(),
  // Shared bearer for the local slow-crawler runner (RI-0023). Unset disables
  // the crawler endpoints entirely.
  CRAWLER_TOKEN: z.string().optional(),
  // Bearer for the DM import runners (#120). Unset disables DM ingest.
  DM_INGEST_TOKEN: z.string().optional(),
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
