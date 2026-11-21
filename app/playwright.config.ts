import { defineConfig } from "@playwright/test";
import { STUB_ENDPOINTS } from "./e2e/stub-idp.js";

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  timeout: 90_000,
  retries: 0,
  use: { baseURL: "http://127.0.0.1:8790" },
  globalSetup: "./e2e/global-setup.ts",
  webServer: {
    command: "bash -c 'set -a; . ./.env; set +a; exec pnpm exec tsx server/dev.ts'",
    url: "http://127.0.0.1:8790/app-api/health",
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      NODE_ENV: "test",
      SCHEDULER_ENABLED: "0",
      RI_RUNNER_ONLINE_WINDOW_MS: "1500",
      RI_OAUTH_ENDPOINTS_JSON: JSON.stringify(STUB_ENDPOINTS),
    },
  },
});
