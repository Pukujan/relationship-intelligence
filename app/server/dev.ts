import { createAppServer } from "./adapter.js";
import { readEnv } from "./env.js";
import { startScheduler } from "./schedules.js";

const env = readEnv();
createAppServer(env).listen(env.PORT, "127.0.0.1", () => {
  console.log(`adapter on http://127.0.0.1:${env.PORT}`);
  // The scheduler is a platform worker: it uses the workspace key to mark due
  // principal-private schedules as queued runs. Execution is a later slice.
  const key = process.env.OCTO_API_KEY;
  const workspaceId = process.env.OCTO_WORKSPACE_ID;
  if (process.env.SCHEDULER_ENABLED !== "0" && key && workspaceId) {
    startScheduler(async () => ({
      config: {
        baseUrl: process.env.OCTO_API_URL ?? env.OCTO_API_URL,
        timeoutMs: 20_000,
      },
      token: key,
      workspaceId,
      principalId: "scheduler",
    }));
    console.log("scheduler ticking every 60s");
  }
});
