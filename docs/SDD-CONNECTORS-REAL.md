# SDD — Make every connector real (RI-0021)

Contract for implementers. Types are TypeScript strict; all payloads Zod-validated at trust boundaries; tenancy via the existing `resolveTenancy` choke for session routes; device routes authenticate by bearer device token only.

## 1. Catalog and env

- `authKind`: replace `oauth_soon` with `provider_oauth` (slack, calendly, discord). Keep `google_oauth`, `zoom_oauth`, `local_runner`.
- env additions (optional strings): `SLACK_CLIENT_ID/SECRET`, `CALENDLY_CLIENT_ID/SECRET`, `DISCORD_CLIENT_ID/SECRET`.
- Test hook (documented, default off): `RI_OAUTH_ENDPOINTS_JSON` — optional JSON map overriding provider authorize/token/api base URLs for deterministic e2e against a stub identity provider. Production never sets it. Zod-validated URLs.

## 2. Provider OAuth (server)

Provider table (server-only constants, overridable by the test hook):
| provider | authorize | token | identity | auth style |
|---|---|---|---|---|
| slack | https://slack.com/oauth/v2/authorize | https://slack.com/api/oauth.v2.access | POST auth.test (user token) | client id/secret in form body; user token = `authed_user.access_token` |
| calendly | https://auth.calendly.com/oauth/authorize | https://auth.calendly.com/oauth/token | GET https://api.calendly.com/users/me | form body |
| discord | https://discord.com/oauth2/authorize | https://discord.com/api/oauth2/token | GET https://discord.com/api/users/@me | HTTP Basic |
| zoom | (existing) | (existing) | GET https://api.zoom.us/v2/users/me | Basic |

Routes (pattern of existing Google/Zoom handlers in adapter.ts):
- `GET /app-api/connectors/oauth/:provider/start` (provider in slack|calendly|discord|zoom): session required; state = `newOauthState()` stored in `session.connectorOauthState` + `session.connectorProvider`; redirect to authorize URL with catalog scopes, redirect_uri `${APP_ORIGIN}/app-api/connectors/oauth/:provider/callback`.
- `GET /app-api/connectors/oauth/:provider/callback`: validate code+state+provider match; **clear session state before exchange (single-use)**; exchange code; fetch identity; `saveUserConnector` connected with tokens server-side, accountEmail/account name from identity; redirect `?connected=:provider`. Errors redirect `?connector_error=STATE_MISMATCH|EXCHANGE_FAILED|NOT_CONFIGURED|SCOPE_NOT_APPROVED` (last when provider rejects a privileged scope, e.g. Discord messages.read).
- `listUserConnectors`: `connectUrl` for provider_oauth when configured; `oauthConfigured` per provider. Unconfigured UI label: `Add <PROVIDER>_CLIENT_ID/SECRET`.
- `sync.ts`: add refresh + read-only fetchers: slack (auth.test, conversations.list+history ≤8), calendly (users/me, scheduled_events ≤8), discord (users/@me, guilds), zoom (users/me + existing meetings). 401/invalid_auth → `saveUserConnector` expired. Items reuse `SyncedSignal` + `matchConnectorRoute` + the activity upsert (idempotent by principal+provider+externalId).

## 3. Runner contract (server)

New tables in `ensureAppWorkspaceTables`:
- `ri_console.runner_pairing(id, principal_id, workspace_id, code_hash, expires_at, used_at, created_at)`
- `ri_console.user_runner(id, principal_id, workspace_id, device_label, token_hash, pairing_status text check in ('paired','revoked'), last_seen_at, created_at, updated_at)`
- `ri_console.runner_consent(principal_id, provider, scopes jsonb, granted_at, revoked_at, primary key(principal_id, provider))`

Routes:
- `POST /app-api/connectors/runner/pair` (session): invalidate prior unused codes; code = 8-char Crockford base32, TTL 600s; store sha256(code); return plaintext code once + expiresAt.
- `POST /app-api/connectors/runner/claim` (no session; {code, deviceLabel ≤80}): match unused unexpired hash; mark used_at (single-use); create user_runner (workspace_id copied from pairing row); deviceToken = 48 hex; store sha256; return {deviceToken, deviceId, principalId}.
- `POST /app-api/connectors/runner/heartbeat` (Bearer deviceToken): paired only; update last_seen_at; return {consents:[{provider,scopes,granted}], now}.
- `POST /app-api/connectors/runner/session-status` (Bearer deviceToken; {provider in linkedin|luma, ok, accountHint?}): ok && consent granted → user_connector connected (+accountEmail hint); !ok → expired. Never stores cookies or browser state.
- `POST /app-api/connectors/runner/consent` (session; {provider in local_runner set, scopes ⊆ catalog, granted}): upsert; granted=false sets revoked_at; ledger event.
- `POST /app-api/connectors/runner/ingest` (Bearer deviceToken; {provider, items:[{externalId,title,detail,occurredAt,matchText,url?,scope}]} ≤50): device paired; consent granted; per-item scope must be consented else rejected{reason:"SCOPE_NOT_CONSENTED"}; accepted items routed (principal's routes, fallback user_runner.workspace_id) and upserted idempotently into activity + ledger_event; user_connector connected + last_sync. Return {accepted, rejected}.
- `POST /app-api/connectors/runner/revoke` (session; {deviceId} owned by principal): pairing_status revoked.
- `GET /app-api/connectors/runner/setup` (session): {installCommand, pairCommand, devices:[{id,label,lastSeenAt,pairingStatus}], consents} — **no tokens, no codes**.
- `listUserConnectors` adds for local_runner: `runnerStatus: "unpaired"|"online"|"offline"` (online = paired device last_seen ≤90s), `consentedScopes`. Disconnect on local_runner also revokes that provider's consent.

Invariants: I1 device token authenticates exactly one principal; I2 ingest never writes another principal's rows; I3 no consent → no ingest; I4 pairing code single-use + TTL; I5 revoked token rejected everywhere; I6 browser-facing responses contain no access/refresh/device tokens or pairing code after claim; I7 cookies/raw browser state never sent to server; I8 activity idempotent by (principal,provider,externalId).

## 4. Daemon (collector/, slice 2)

CLI `pnpm run daemon -- <cmd>` (tsx): `pair --code --server`, `start [--loop]` (heartbeat 30s), `signin --provider linkedin|luma` (attach over CDP to human-started real browser per src/attach.ts; read-only session check; report session-status), `collect --provider linkedin|luma` (read-only own-profile/events fetch → ingest), `wispr-watch --dir` (user-exported JSON {id,text,createdAt} → ingest scope dictation:ingest), `riley-serve` (127.0.0.1-only HTTP POST /brief {id,title,detail,occurredAt,kind} → ingest voice:brief|voice:triage), `push --provider --file` (deterministic ingest path for tests), `status`.
State: `RI_DAEMON_ROOT` default `~/.cache/ri-daemon` (0700); device.json 0600 {deviceToken,deviceId,server}. Boundaries unchanged from proof: human signs in manually; no passwords/OTP seen; no stealth/challenge bypass; read-only; cookies never leave the machine.

## 5. Console UX

- provider_oauth configured → existing Connect link; unconfigured → `Add X_CLIENT_ID/SECRET`.
- local_runner → "Set up" opens `RunnerSetupDialog`: (1) copy install+pair commands; (2) "Generate pairing code" shows code+expiry once; (3) per-scope consent toggles with one-line explanations; (4) device list online/offline + Revoke; (5) status chip: expired → "Re-auth needed", runnerStatus offline → "Device offline", unpaired → "Needs setup".
- No secret rendered after claim; code shown only at generation.

## 6. File ownership (parallel agents)

server: app/server/{env,connectors,adapter,sync,workspaces}.ts, app/tests/connectorsReal.test.ts, app/tests/connectorsMetamorphic.test.ts.
daemon: collector/**.
console: console/src/pages/integrations/Connectors.tsx, console/src/components/integrations/*, app/e2e/** (Playwright + iron-session live in app).
Shared shapes are fixed by this SDD; do not edit outside your ownership.

## 7. Test tenancy and fixtures (e2e + metamorphic)

- Dev server: source app/.env (test-only SESSION_PASSWORD, APP_ORIGIN http://127.0.0.1:8790, stub provider creds, RI_OAUTH_ENDPOINTS_JSON pointing at app/e2e/stub-idp.ts). Never set the hook in production.
- Principal A: real active Octo member (owner). Principal B: fixture principal — insert ri_console.app_user + workspace_member (active) into a uniquely-slugged fixture workspace via octoSql with the owner key; resolvePrincipalWorkspaces admits app-level members. Seal ri_session cookies with iron-session (test password) for both; no production auth change.
- All fixtures (workspaces, members, connectors, runners, consents, activity) use uuid principals/slugs and are deleted in afterAll; real workspaces and the owner's personal rows are never modified.
- Metamorphic suites may run against live Octo with the same fixture discipline (repo convention: real integration, isolated fixtures).

## 8. Critique amendments (binding; override earlier text on conflict)

Independent critique 2026-11-20 (critique2). Items R4, R7, R12, R13, R15, R17, R18 are RETROFITS of existing defects — implement them, do not inherit the old behavior.

- R1 resolveDevice choke: sha256(bearer) lookup user_runner.token_hash WHERE pairing_status='paired' (indexed); returns {principalId, workspaceId, deviceId} from the row only. Device-route SQL uses the owner key explicitly and filters principal_id from that result, never from the body. pair stores workspace_id from resolveTenancy's active workspace; claim body is {code, deviceLabel} only.
- R2 claim atomicity: single statement UPDATE ri_console.runner_pairing SET used_at=now() WHERE code_hash=<hash> AND used_at IS NULL AND expires_at>now() RETURNING id, principal_id, workspace_id; device INSERT only after a returned row; fail-closed. Per-IP limit 10 attempts/10min then 429. Code Zod regex ^[0-9A-HJKMNP-TV-Z]{8}$ after Crockford normalization (uppercase; I/L->1, O->0). Indexes on runner_pairing(code_hash) and user_runner(token_hash). TTL 600s, server now().
- R3 multi-device kept; claim never revokes other devices. MR-K5 rewritten to explicit revoke (VALIDATIONS updated).
- R4 route targets: createConnectorRoute validates targetWorkspaceId in principal's active workspaces and targetProjectId in that workspace (400 otherwise); ingest/sync re-check membership at write time, fallback to the principal's Personal workspace. Retrofit existing createConnectorRoute.
- R5 riley-serve: device.json gains localSecret (0600); POST /brief requires X-Riley-Secret header equal to it (custom header forces CORS preflight); validate Host is loopback and reject foreign Origin; ingest remains consent-gated.
- R6 device-route 401 bodies {error:"INVALID_DEVICE_TOKEN"} or {error:"DEVICE_REVOKED"} when the row exists revoked; accountHint Zod max 120; session-status provider enum linkedin|luma.
- R7 saveUserConnector gains clearTokens flag -> SET access_token=NULL, refresh_token=NULL, expires_at=NULL; disconnect uses it; unit test asserts NULL columns afterwards.
- R8 secret-bearing responses are exactly: pair -> {code, expiresAt} (browser, once) and claim -> {deviceToken, deviceId, principalId} (daemon only). setup/heartbeat/list/config never include tokens, codes, token_hash, code_hash. I6 means this.
- R9 browser error details are fixed enums plus provider HTTP status only; never provider bodies, token-bearing URLs, or raw exception text; logs redact token values.
- R10 granted := consent row exists AND revoked_at IS NULL; granted=true replaces scopes, sets revoked_at=NULL, granted_at=now(); consent is principal-global across devices; ingest requires granted AND item.scope in scopes.
- R11 item.scope is a Zod enum of the provider's catalog scopes; unknown -> rejected UNSUPPORTED_SCOPE. luma rsvp:consent means staging RSVP proposals for human approval only; the daemon never executes RSVPs.
- R12 session.connectorOauthStates: per-provider map {state, createdAt} replacing the single slot (session.ts); TTL 600s; start routes enforce isIdleExpired; callback verifies path provider matches the stored provider for that state; clear that provider's state BEFORE exchange on ALL callbacks, retrofitting google and zoom.
- R13 the generic /app-api/connectors/oauth/:provider/start|callback REPLACES the dedicated zoom handlers; redirect_uri strings byte-identical to today's; delete the legacy zoom exact-match blocks.
- R14 slack authorize uses user_scope=channels:history,users:read (no bot scopes); user token = authed_user.access_token (+refresh_token). calendly authorize scope=default; catalog scheduled_events:read stays an internal consent label. Verify discord/zoom params against live docs during smoke.
- R15 one shared helper app/server/sql.ts: lit() plus NUL/control-char rejection at the Zod layer; replace the five copy-pasted lit definitions (connectors, adapter, sync, tenancy, workspaces) with imports; per-field length caps; jsonb only via JSON.stringify+lit; zero identifier interpolation; matchConnectorRoute semantics pinned (comma-separated substring terms plus '*').
- R16 ingest body cap 256KB with clean 413 JSON; per-field caps (externalId<=120, title<=200, detail<=2000, url<=500, matchText<=2000, occurredAt ISO, scope enum) so 50 items fit; all other routes keep 8KB.
- R17 activity id = "sync-" + principalId + "-" + provider + "-" + externalId; one-time migration in ensureAppWorkspaceTables rewriting legacy 'sync-%' ids from each row's principal_id; upsert DO UPDATE touches doc fields only (title/detail/url/occurred_at/match_text/updated_at), never principal_id/workspace_id; MR-K3 includes the same-externalId cross-principal case.
- R18 appendLedgerEvent accepts optional deterministic eventId; ingest uses sha256(principal|provider|externalId|eventType) with ON CONFLICT DO NOTHING; other events keep randomUUID.
- R19 shared shape lives in app/shared/contracts.ts (pre-written by lead; includes CONNECTOR_CRED_PREFIX and deriveConnectorChip). Server returns it; console imports it; no local re-declarations.
- R20 console ownership extends to console/src/data/derive.ts and console/src/types.ts; routing dropdown catalog-driven (all 11 providers); local_runner cards hide "Sync now"; /app-api/connectors/:provider/sync returns 400 UNSUPPORTED_PROVIDER for local_runner.
- R21 RI_OAUTH_ENDPOINTS_JSON honored only when NODE_ENV!=="production"; in production ignore it and console.warn; Zod https-only URL map; boot log when active. RI_RUNNER_ONLINE_WINDOW_MS (default 90000) same guard.
- R22 Playwright lives in app: app/playwright.config.ts, testDir app/e2e, workers 1; globalSetup starts stub IdP on 127.0.0.1:8791 and exports RI_OAUTH_ENDPOINTS_JSON for the webServer (tsx server/dev.ts with app/.env sourced).
- R23 stub-idp.ts: per-provider authorize (echo state, mint single-use code), token (exchange once; replay 400), identity per §2 table; modes: force401 (identity+sync 401) and rejectScope (authorize invalid_scope). E2E-Runner sets RI_RUNNER_ONLINE_WINDOW_MS=1500 for deterministic offline; daemon slice must land before runner e2e can pass (lead sequences).
- R24 fixtures: uuid principals + unique workspace slugs per suite; afterAll deletes runner_pairing/user_runner/runner_consent/user_connector/activity/ledger_event/workspace_member/workspace rows for fixture ids only; the owner's real rows are never touched.

