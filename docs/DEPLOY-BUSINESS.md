# business.design-bakery.com — deployment

The console + API run in a single Docker container (`relationship-intelligence`) on
`octo-vps` behind Cloudflare Tunnel `business-ri` (`business-ri-cloudflared` on
`study-os_edge`). Octo (`https://octodb.design-bakery.com`) is the remote data
and Arize Phoenix OTLP tracing layer; our adapter owns Google sign-in (no Octo redirect).

## Pieces

- **Adapter (`app/server`):** Serves `/app-api/*`, `/octo-auth/*`, and the built console
  at `/console/` (SPA fallback, resolved relative to `import.meta.url`) from one
  process on `:8787` (`127.0.0.1:18098->8787` on `octo-vps`).
- **VPS Compose & Komodo CD:** `deploy/docker-compose.vps.yml` + `deploy/vps/autodeploy.sh`
  build `origin/main` from the root `Dockerfile`, swap the container, wait for
  `/app-api/health`, and roll back on failure (registered in
  `Pukujan-lab/server-management` `komodo/resources/stacks-vps.toml`).
- **Cloudflare Tunnel `business-ri`:** Runs in container `business-ri-cloudflared`
  (`cloudflare/cloudflared:2026.10.7`) on `octo-vps` (`study-os_edge`), routing
  `business.design-bakery.com -> http://relationship-intelligence:8787`.
- **Runtime environment:** Lives on `octo-vps` at `~/apps/relationship-intelligence.env`
  (`chmod 600`), including `APP_ORIGIN=https://business.design-bakery.com` and
  `PHOENIX_COLLECTOR_ENDPOINT=https://octodb.design-bakery.com/api/workspaces/<OCTO_WORKSPACE_ID>/otel/v1/traces`.

## Local dev

```bash
pnpm --dir console build          # produces console/dist served by the adapter
cd app && set -a && source .env && set +a && pnpm dev
```

## Google sign-in & connectors (our own client)

- Google Cloud OAuth client (Web application), authorized redirect URIs:
  - Sign-in: `https://business.design-bakery.com/octo-auth/google/callback`
  - User connectors (Gmail / Calendar / Drive): `https://business.design-bakery.com/app-api/connectors/oauth/google/callback`
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` live only in gitignored env files.
- Flow: `/octo-auth/google/start` (state bound to session) -> Google -> callback
  exchanges code, verifies `id_token`, maps verified email to an Octo principal
  via `ri_console.workspace_member`, and seals the session cookie. Octo is never
  in the browser redirect path.

## Secrets

Tunnel credentials and API/OAuth secrets stay strictly outside git (`chmod 600` on `octo-vps`).
