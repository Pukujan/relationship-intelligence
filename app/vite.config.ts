import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  plugins: [react()],
  server: {
    port: 5173,
    // Browser calls same-origin /app-api/* and /octo-auth/*; the dev server
    // forwards them to the local adapter. No token ever reaches Vite.
    proxy: {
      "/app-api": "http://127.0.0.1:8787",
      "/octo-auth": "http://127.0.0.1:8787",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
