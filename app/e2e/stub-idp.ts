/**
 * RI-0021 stub identity provider for deterministic OAuth e2e (R23).
 * Single-use codes, state echo, force401 and rejectScope modes. Test-only.
 */
import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";

const codes = new Map<string, { provider: string; used: boolean }>();
let mode: "normal" | "force401" | "rejectScope" = "normal";

export const STUB_ENDPOINTS = {
  slack: { authorize: "http://127.0.0.1:8791/slack/authorize", token: "http://127.0.0.1:8791/slack/token", api: "http://127.0.0.1:8791/slack" },
  calendly: { authorize: "http://127.0.0.1:8791/calendly/authorize", token: "http://127.0.0.1:8791/calendly/token", api: "http://127.0.0.1:8791/calendly" },
  discord: { authorize: "http://127.0.0.1:8791/discord/authorize", token: "http://127.0.0.1:8791/discord/token", api: "http://127.0.0.1:8791/discord" },
  zoom: { authorize: "http://127.0.0.1:8791/zoom/authorize", token: "http://127.0.0.1:8791/zoom/token", api: "http://127.0.0.1:8791/zoom" },
};

export function startStubIdp(port = 8791): Promise<Server> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const seg = url.pathname.split("/").filter(Boolean);
    const provider = seg[0] ?? "";
    const action = seg[1] ?? "";
    const send = (status: number, obj: unknown) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
    const redirect = (loc: string) => { res.writeHead(302, { Location: loc }); res.end(); };
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      if (provider === "__mode") { mode = (JSON.parse(body || "{}").mode ?? "normal") as typeof mode; return send(200, { mode }); }
      if (action === "authorize") {
        const ru = url.searchParams.get("redirect_uri") ?? "";
        const state = url.searchParams.get("state") ?? "";
        if (mode === "rejectScope") return redirect(`${ru}?error=invalid_scope&state=${state}`);
        const code = randomBytes(8).toString("hex");
        codes.set(code, { provider, used: false });
        return redirect(`${ru}?code=${code}&state=${state}`);
      }
      if (action === "token") {
        const params = new URLSearchParams(body);
        const code = params.get("code") ?? "";
        const entry = codes.get(code);
        if (!entry || entry.used) return send(400, { error: "invalid_grant" });
        entry.used = true;
        if (provider === "slack") return send(200, { ok: true, authed_user: { access_token: "stub-slack-user", refresh_token: "stub-slack-refresh", expires_in: 3600, scope: "channels:history,users:read" } });
        return send(200, { access_token: `stub-${provider}-token`, refresh_token: `stub-${provider}-refresh`, expires_in: 3600, scope: "default" });
      }
      if (provider === "slack" && action === "auth.test") return send(200, { ok: true, user: "stub", team: "testteam" });
      if (provider === "slack" && action === "conversations.list") {
        if (mode === "force401") return send(401, { error: "unauthorized" });
        return send(200, { channels: [{ id: "C1", name: "general" }] });
      }
      if (provider === "slack" && action === "conversations.history") {
        if (mode === "force401") return send(401, { error: "unauthorized" });
        return send(200, { messages: [{ ts: "1700000000.000100", text: "hello from stub", user: "U1" }] });
      }
      if (provider === "calendly" && action === "users" && seg[2] === "me") return send(200, { resource: { uri: "https://api.calendly.com/users/stub", email: "stub@calendly.test", name: "Stub Calendly" } });
      if (provider === "calendly" && action === "scheduled_events") {
        if (mode === "force401") return send(401, { error: "unauthorized" });
        return send(200, { collection: [{ uri: "ev-1", name: "Intro call", start_time: new Date(Date.now() + 86400000).toISOString() }] });
      }
      if (provider === "discord" && seg[1] === "users" && seg[2] === "@me" && seg[3] === "guilds") {
        if (mode === "force401") return send(401, { error: "unauthorized" });
        return send(200, [{ id: "g1", name: "stub guild" }]);
      }
      if (provider === "discord" && action === "users" && seg[2] === "@me") return send(200, { email: "stub@discord.test", username: "stubdiscord" });
      if (provider === "zoom" && action === "users" && seg[2] === "me") {
        if (seg[3] === "meetings") {
          if (mode === "force401") return send(401, { error: "unauthorized" });
          return send(200, { meetings: [{ id: 1, topic: "Stub meeting", start_time: new Date().toISOString(), join_url: "https://zoom.test/j/1" }] });
        }
        return send(200, { email: "stub@zoom.test", first_name: "Stub", last_name: "Zoom" });
      }
      send(404, { error: "not_found" });
    });
  });
  return new Promise((r) => server.listen(port, "127.0.0.1", () => r(server)));
}

if (process.argv[1]?.endsWith("stub-idp.ts")) {
  startStubIdp().then(() => console.log("stub idp on 8791"));
}
