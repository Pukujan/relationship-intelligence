import { createAppServer } from "./adapter.js";
import { readEnv } from "./env.js";

const env = readEnv();
createAppServer(env).listen(env.PORT, "127.0.0.1", () => {
  console.log(`adapter on http://127.0.0.1:${env.PORT}`);
});
