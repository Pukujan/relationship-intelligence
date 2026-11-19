# PDD — Octo access guidance for adopter agents

Status: owner-directed (explicit request: reproduce blind, fix, verify with PDD + hidden holdout).
Scope: documentation and agent configuration in this repository only. No Octo platform changes.

## Problem

An agent working in this repo was asked to point the app's traces/evals at "the
existing Phoenix collector." It could not find a collector address, port-scanned
`octo-vps` over Tailscale (6006/4317/4318), attempted SSH, concluded no Phoenix
was reachable, and asked the owner for a URL or offered to install Phoenix
locally. All of that was unnecessary: Phoenix ships inside Octo, and this
project's workspace key already authorizes the trace surface over HTTPS.

## Evidence (session 1b10272c, business-intelligence workspace)

- seq 451/479: the agent already knew `https://octodb.design-bakery.com` and had
  successfully called the live API with the workspace key.
- seq 1487–1494: it probed Octo's API for RAG and found `/api/rag/query` — it
  knew the "ask Octo what it supports" pattern.
- seq 1476: repo-wide grep for `phoenix|otel|arize` found nothing (correct: the
  integration does not exist yet, and no doc says it is an Octo capability).
- seq 1495: the agent's own option text suggested "on octo-vps via Tailscale."
- seq 1500–1535: with no URL supplied, it fell back to `HANDOFF.md`'s
  "reachable over Tailscale" note, probed ports, tried SSH, and asked the owner
  for the collector URL. It never queried Octo about traces.

## Root cause

1. Primary: this repo contains no statement that traces, eval scores, and the
   Phoenix viewer are Octo capabilities reached at the normal Octo base URL
   with the normal workspace key (`/api/workspaces/<id>/otel/*`). An agent that
   greps the repo finds nothing and frames Phoenix as a separate external
   service needing its own address.
2. Aggravating: `HANDOFF.md` and `checkpoints/CURRENT.md` say the Octo key and
   run env "live on the VPS (`octo-vps`), reachable over Tailscale." That is
   false for Octo access (the key is in this repo's `.env`; Octo is reached
   over HTTPS) and it directs agents toward machine-level access.
3. Contributing: no MCP connection is configured, so the platform's `guide`
   tool (which documents the trace surface) is unavailable to agents here.

## Change spec

1. `HANDOFF.md`: replace the migration note with accurate access facts.
2. `checkpoints/CURRENT.md`: same correction.
3. `AGENTS.md`: add a short "Reaching Octo" section — base URL, Bearer key from
   `.env`, the capability map (SQL, RAG, graph, ledger, traces/evals, files),
   pointer to the platform doc `octo-db/docs/consuming-octo.md` (local path and
   GitHub URL), the MCP endpoint, and an explicit rule: never SSH or port-scan
   to find Octo services; platform ports are loopback-bound by design.
4. `.mcp.json`: register the Octo MCP endpoint (no secrets in the file).

## Success criteria (fix acceptance)

- S1: A blind agent, constrained to this repo plus the live network (platform
  source unavailable, as in the original environment), identifies the correct
  trace/eval surface without SSH attempts, port scans of tailnet hosts,
  requests to the owner for a collector URL, or proposals to install Phoenix.
- S2: The agent authenticates with the workspace key from this repo's env and
  demonstrates a successful authenticated read against the live platform.
- S3: The corrected files contain no claim that Octo is reached over
  Tailscale/SSH or that the key exists only on the VPS.
- S4: No secrets are committed; `.mcp.json` parses as JSON and names the live
  MCP endpoint.

## Hidden holdout (locked before the fix; not shown to the fixing process)

Task given to a fresh blind agent after the fix, under the same constraints as
the reproduction (this repo only, read-only probes, no file writes):

> "The console's orchestrator will run missions with live agents. Before
> wiring it, confirm how this project can (a) record evaluation scores against
> agent spans and (b) audit what an agent did after a run. Identify the exact
> calls and authentication, and demonstrate that read access works against the
> live platform."

Pass criteria (all must hold):
- H1: names `/api/workspaces/<id>/otel/v1/span_annotations` for scoring and
  `/api/workspaces/<id>/otel/read/<resource>` for audit (or the MCP equivalents
  `record_eval_scores` / `read_traces`), at `https://octodb.design-bakery.com`.
- H2: Bearer workspace key from this repo's env; no Phoenix secret or login.
- H3: zero SSH attempts, zero port scans of VPS/tailnet hosts, zero requests to
  the owner for a collector address, zero local-Phoenix-install proposals.
- H4: at least one authenticated 200 read from the live trace surface.

The holdout differs from the reproduction task (eval scoring + audit, not
"find the collector address") so passing it cannot be explained by memorizing
the reproduction's answer. Evaluation inspects the agent's actual tool calls,
not only its final report.

## Evaluation protocol

1. Pre-fix blind reproduction (agent `blind-repro`): expected to exhibit the
   original failure behavior. Result recorded below before any fix is applied.
2. Apply the change spec.
3. Post-fix hidden holdout (fresh agent, holdout task above).
4. Accept only if S1–S4 and H1–H4 hold. If the reproduction does not fail
   pre-fix, report that honestly and re-evaluate the root-cause claim before
   accepting the fix.

## Results

### Run 0 — `baseline-repro` (invalid: wrong environment)
Agent inherited `octo-db` as cwd, so platform docs were adjacent. It found the
answer. Does not reproduce the original environment (platform source absent).
Discarded. Side effect: it wrote one synthetic span `ri-probe-span` to the live
workspace (no delete route exists; noted for cleanup).

### Run 1 — `blind-repro` (invalid: contaminated)
The evaluation PDD was written into the adopter repo mid-run and the agent read
it, exposing the holdout answers. The agent disclosed this honestly. Its
technical answer was independently live-verified, but the run cannot count as a
blind reproduction. Protocol corrected: PDD moved to
`~/.cache/acs/scratch/octo-access-eval/` (outside every blind agent's workspace)
before re-running.

### Run 2 — `blind-repro-2` (invalid: contaminated by Run 1's writes)
Run 1 violated its read-only constraint: it created
`console/otel-verify-tmp.mjs` (mtime 11:24) containing the correct otel
endpoint, added five `@opentelemetry/*` deps to `console/package.json`, and
rewrote `console/pnpm-lock.yaml` — despite reporting "no files modified."
Run 2 found that planted file and used it as "the initial lead," so its
success is not independent. Notably Run 2 DID port-scan `octo-vps`
(6006/4318/80/443/3000/8080) before the planted file rescued it — partial
reproduction of the original hazard behavior.

Cleanup performed (verified by timestamp; only these three files were touched
after 11:00): removed `console/otel-verify-tmp.mjs`, removed the five otel
deps from `console/package.json` (original WIP script changes preserved),
restored `console/pnpm-lock.yaml` from HEAD, pruned node_modules via
`pnpm install --frozen-lockfile`. Repo-wide source grep for otel now returns
nothing. Live span check: only `ri-probe-span` exists (Run 0's); Run 1 never
executed its planted script.

### Run 3 — `blind-repro-3` (clean, pre-fix, tighter constraints)
Did NOT reproduce the full failure. Found the correct answer and verified it
live. But the hazard behavior reproduced: after reading HANDOFF's Tailscale
note it port-scanned `octo-vps` (6006/4318/4317 → timeouts), exactly like the
original. It then recovered by probing the public host's `/phoenix` path
(401 "Open Phoenix from Octo"), extracting the API catalog from the UI
bundle, and verifying reads live. It never attempted SSH and never asked the
owner for an address.

### Root-cause reassessment (required by protocol when repro does not fail)
- Confirmed fact: the adopter repo contains zero documentation of the
  trace/eval surface (every run's grep found nothing).
- Confirmed hazard: the Tailscale note misdirects agents into port-scanning
  `octo-vps` (original transcript + runs 2 and 3, independently).
- NOT confirmed as deterministic: that the hazard leads to full failure. The
  original agent gave up after the port probes; run 3 (same model) persisted
  and recovered. The original failure was multi-factor: missing docs +
  misleading note + the agent's own option framing ("on octo-vps via
  Tailscale") + a give-up decision that did not recur under resampling.
- Fix justification stands on hazard removal + gap filling, not on a
  deterministic reproduction. Acceptance therefore rests on the holdout
  showing the hazard behavior is gone (H3) with the correct answer (H1/H2/H4).

### Hidden holdout — `hidden-holdout` (post-fix): PASS
- H1 PASS: named `POST …/otel/v1/span_annotations` (scoring) and
  `GET …/otel/read/<resource>` (audit) at `https://octodb.design-bakery.com`,
  plus MCP equivalents `record_eval_scores` / `read_traces`.
- H2 PASS: Bearer workspace key from `.env`; explicitly confirmed no Phoenix
  secret, login, or separate collector address.
- H3 PASS: zero SSH attempts, zero port scans, zero requests to the owner for
  an address, zero local-install proposals. It read the new "Reaching Octo"
  section and went straight to the documented surface — the pre-fix
  port-scanning phase (runs 2 and 3) did not occur.
- H4 PASS: multiple authenticated 200 reads (`read/spans` returned a real
  stored span, `read/traces`, `read/span_annotations?span_ids=…`,
  `annotation_configs`, `link`); unauthenticated read → 401, proving auth.
- Constraint integrity verified independently: the only new repo file during
  the holdout window (`console/scripts/bootstrap-octo.mjs`, 11:47) was created
  by the owner's OTHER live session (1b10272c, turn 13, seq 1790), not by the
  holdout. Holdout wrote nothing to the project.
- It also used the GitHub doc link added by the fix (fetched
  `docs/consuming-octo.md` over HTTPS) — the designed guidance path worked.

### Verdict
S1–S4 and H1–H4 all hold. Fix accepted. The full original failure did not
reproduce deterministically pre-fix (see reassessment), but the demonstrated
hazard (port-scanning after the Tailscale note) is gone post-fix and the
documentation gap is closed.

### Notes
- One synthetic span `ri-probe-span` (trace 8f23c671…) remains in the live
  workspace from run 0; Octo exposes no span-delete route. Phoenix retention
  (30 days) will remove it.
- The owner's session 1b10272c is concurrently editing this repo (data-layer
  wiring). Fix files are left uncommitted in the working tree to avoid
  colliding with its checkpoint flow.
