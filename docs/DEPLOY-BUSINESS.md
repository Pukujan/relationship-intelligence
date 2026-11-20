# business.design-bakery.com — deployment

The console + API run from this Mac behind a Cloudflare Tunnel; Octo is a remote
data layer only. Our adapter owns Google sign-in (no Octo redirect).

## Pieces

- Adapter (app/server) serves `/app-api/*`, `/octo-auth/*`, and the built console
  at `/console/` (SPA fallback) from one process on :8787.
- Cloudflare Tunnel `business-ri` (id f025d805-c800-4944-b615-9b4ad7e4db57),
  config `~/.cloudflared/business-ri.yml`, ingress
  `business.design-bakery.com -> http://localhost:8787`.
  Run: `cloudflared tunnel --config ~/.cloudflared/business-ri.yml run business-ri`.
- DNS: proxied CNAME `business.design-bakery.com` -> tunnel (created via
  `cloudflared tunnel route dns`).
- `APP_ORIGIN=https://business.design-bakery.com` (secure cookies).

## Build & run

```bash
pnpm --dir console build          # produces console/dist served by the adapter
cd app && set -a && source .env && set +a && pnpm dev
cloudflared tunnel --config ~/.cloudflared/business-ri.yml run business-ri
```

## Google sign-in (our own client)

- Google Cloud OAuth client, Web application, authorized redirect URI:
  `https://business.design-bakery.com/octo-auth/google/callback`.
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in `app/.env` (gitignored).
- Consent screen is testing-mode: sign-in emails must be listed as test users.
- Flow: our `/octo-auth/google/start` (state bound to our session) -> Google ->
  our callback exchanges the code, verifies the id_token, maps the verified
  email to an Octo principal via workspace membership, seals our cookie.
  Data calls use the server-side `OCTO_API_KEY` plus the principal id from our
  cookie. Octo is never in the redirect path.

## Secrets

Tunnel credentials `~/.cloudflared/<tunnel-id>.json` and `cert.pem` are private;
never commit. API keys and Google secret live only in gitignored `.env` files.
