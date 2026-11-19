import { defineConfig } from "vite";
import dyadComponentTagger from "@dyad-sh/react-vite-component-tagger";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig(() => ({
  // Served under the app origin at /console/ so the adapter's session cookie
  // (same origin, any port on localhost) authenticates owner mode.
  base: "/console/",
  server: {
    host: "::",
    port: 8080,
    proxy: {
      // The copilot server (console/server/index.ts). The model key never
      // reaches the browser; the client only talks to this origin.
      "/api": {
        target: "http://127.0.0.1:8799",
        changeOrigin: true,
      },
      // The app adapter owns sign-in and the principal-token world routes.
      "/app-api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
      "/octo-auth": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
  plugins: [dyadComponentTagger(), react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
