/**
 * One command for the console: the copilot server and the Vite dev server.
 *
 * No extra dependency: plain child processes, and whichever exits first stops
 * the other so a crashed brain never leaves a headless UI behind (and the
 * reverse). The browser reaches the model only through Vite's /api proxy.
 */
import { spawn } from "node:child_process";
import process from "node:process";

const run = (name, command, args) => {
  const child = spawn(command, args, {
    stdio: ["inherit", "inherit", "inherit"],
    env: process.env,
  });
  child.on("exit", (code, signal) => {
    console.log(`[dev] ${name} exited (${signal ?? code})`);
    process.exit(code ?? 0);
  });
  child.on("error", (error) => {
    console.error(`[dev] ${name} failed to start:`, error.message);
    process.exit(1);
  });
  return child;
};

const server = run("copilot", process.execPath, [
  "--env-file-if-exists=.env",
  "server/index.ts",
]);
const web = run("vite", process.execPath, [
  ...process.execArgv,
  "./node_modules/vite/bin/vite.js",
  ...process.argv.slice(2),
]);

const stop = () => {
  server.kill("SIGTERM");
  web.kill("SIGTERM");
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
