# VALIDATIONS — Make every connector real (RI-0021)

Layers per docs/VALIDATION.md. Every acceptance criterion in RI-0021 maps to at least one proof below.

## Public deterministic (Vitest + fast-check, app/tests)

- connectorsReal.test.ts: Zod boundary rejects (bad scopes, oversize items, bad code); pairing single-use+TTL (I4); revoked token rejected (I5); consent required (I3); identity fetch failure → EXCHANGE_FAILED; state single-use (MR-K6).
- connectorsMetamorphic.test.ts (relations on canonical activity/connector state, excluding run ids/timestamps):
  - MR-K1 ingest identical items twice ≡ once (I8).
  - MR-K2 permute item order / split batches ≡ same final state.
  - MR-K3 interleave principal B operations (incl. same externalId ingest) → principal A state unchanged (I2, R17).
  - MR-K4 revoke consent then ingest → rejected, no new activity.
  - MR-K5 revoke device → its token rejected on every device route; other devices of the same principal unaffected; re-pair adds a device (multi-device, R3).
  - MR-K6 replay OAuth state/callback → rejected, no second connector write.
  - MR-K7 heartbeat/offline transition does not discard session state (expired ≠ offline).

## Real user flows (Playwright, console/e2e)

Stub identity provider (app/e2e/stub-idp.ts) + `RI_OAUTH_ENDPOINTS_JSON` on a dev server; test tenancy per SDD §7 (sealed cookies for real member A + fixture principal B; fixture cleanup mandatory):
- E2E-OAuth: sign in → Connect Slack/Calendly/Discord/Zoom → stub consent → callback → Connected chip with account identity; Disconnect → needs_setup; forced 401 sync → expired chip.
- E2E-Runner: Set up → generate code → real daemon `pair`/`start` → online chip; consent toggles; `push` fixture → routed activity visible; revoke consent → push rejected; kill daemon → "Device offline" (not expired); revoke device → token dead.
- E2E-UI: unconfigured OAuth shows Add-credentials label; no access/refresh/device tokens or hashes in any browser-facing response; pairing code appears only in the pair response and never after claim (R8). MR-K1 comparison set = activity + user_connector + consents; ledger receipts are append-only audit (ingest dedup asserted separately via R18).

## Live smoke (post-merge, owner credentials)

Google #49 flow unchanged; add real Slack/Calendly/Discord/Zoom creds when approved; LinkedIn/Luma `signin`+`collect` on owner machine (residential IP, real browser); traces visible in Octo Phoenix.

## Hidden holdout

Locked pre-implementation at `~/.cache/acs/scratch/ri-0021-eval/HOLDOUT.md` (chmod 600, outside all implementer workspaces). SHA256 recorded below after locking. Fresh blind agent post-fix; evaluation inspects tool calls, not only the report; holdout writes nothing to the repo.

SHA256(HOLDOUT.md): 3e2482b458487f7853cbc205ea4e876649705c7ab91fb2803926b9c4c69a9b26
