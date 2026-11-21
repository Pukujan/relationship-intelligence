# PDD — Make every connector real (RI-0021)

**Status:** plan accepted by owner direction 2026-11-20. Companion: SDD-CONNECTORS-REAL.md (contract), VALIDATIONS-CONNECTORS-REAL.md (proof).

## Problem and consequence

The connectors page promises eleven integrations but delivers three. "OAuth wiring next" and "Local session runner" are static labels: the backend supplies no connect URL for Slack/Calendly/Discord and no pairing/consent/ingest contract for LinkedIn/Luma/Wispr/Riley. Consequence: teammates cannot do their jobs in the product; the collection plan (docs/COLLECTION-EXECUTION.md, accepted slice 1) stalls at slice 2.

## Evidence

- Deployed bundle renders `e.connectUrl ? <Connect> : <static label>`; no runner installer or instructions exist anywhere in the bundle.
- `app/server/connectors.ts`: `oauth_soon` and `local_runner` kinds always yield `connectUrl: null`.
- `collector/` is the passed slice-1 proof (persistent real-browser session, attach-over-CDP), explicitly "not the daemon".

## Plan (three workstreams, disjoint file ownership)

1. **Server OAuth wiring** — promote slack/calendly/discord to real provider OAuth beside the existing Google/Zoom handlers; identity fetch on callback; refresh + expired handling; sync workers fetch real read-only signals. Owner: server agent (`app/server/*`, `app/tests/connectors*`).
2. **Runner daemon (collection slice 2)** — build the daemon on the proof: device pairing to a principal, per-scope consent, heartbeat, consent-gated ingest; LinkedIn/Luma attach to the human's real browser; Wispr ingest of user-initiated exports; Riley loopback brief bridge. Owner: daemon agent (`collector/*`).
3. **Console setup UX** — Connect buttons for configured OAuth; setup dialog for runners (install command, pairing code, consent toggles, device status, revoke); distinct expired vs device-offline states. Owner: console agent (`console/src/*integrations*`, `console/e2e/*`).

Sequence: packet + locked holdout → independent critique → implementation (parallel, disjoint files) → public unit/property + metamorphic suites → Playwright user flows against a stub identity provider → fresh-agent hidden holdout → gates → PR → owner merge → live smoke with real credentials.

## Risks and honest limits

- Discord `messages.read` and Zoom outside-account use require provider approval; wiring is real but live use waits on credentials/approval (documented, surfaced as connector_error, never faked).
- LinkedIn session longevity is proven for one restart only (slice 1); daemon reports expiry honestly instead of working around challenges.
- No Tauri shell (slice 4), no X provider, no bulk crawling, no autonomous outreach — unchanged non-goals.
- Owner's other session edits the primary tree; all work lands in an isolated worktree to avoid clobbering.

## Out of scope

Tauri packaging, TinyFish transport return, new canonical stores. Octo remains canonical; the application still stores no cookies.
