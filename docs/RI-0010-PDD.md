# RI-0010 — Session copilot: tabbed research threads with visual parts

**Status:** local draft, not filed. Owner direction of 2026-11-19: chat-like tabs
for research and the agent interface, plus a floating companion window; the
governing rule agreed in conversation is *windows are views, not brains*.
Depends on PR #22 (intelligence layer, Octo owner mode, provider pool) merging.

## The situation

Researching Jane Doe today means opening the ⌘K modal, reading one answer, and
closing it before you can look at the Acme Labs graph again. Two questions in
parallel are impossible: the modal holds one exchange, and reloading the page
loses it. `console-preview/owner-copilot.png` shows the shape — a single thread
in a dialog, over a workspace that is itself a graph you need to see while you
think. The copilot is a colleague you can only talk to through a keyhole.

## What this slice is

Persistent, scope-pinned conversations rendered as tabs, with typed visual
parts, real streaming, and a context panel that keeps the graph visible. The
modal exchange model is removed; ⌘K opens or focuses a tab. Agents appear as
participants inside a thread, never as separate windows. A companion dock
(RI-0011) projects the signal layer over the same state.

## Acceptance criteria

- [ ] Conversations and messages persist in `ri_console` (principal-private by
      default, promotable like all work). A reload — and a second device signed
      into the same principal — resumes the same tabs.
- [ ] Each tab pins a scope (workspace / project / person / mission). The digest
      sent to the model is built from that scope; a chip row shows what the tab
      can see. Two tabs on different people never leak each other's claims
      (property test).
- [ ] Messages are ordered parts: `text | table | kpi | sparkline | graph-snippet
      | timeline | proposal | approval | artifact`. The server validates ids and
      evidence per part; unverified claims render visually distinct (amber,
      dashed) and never aggregate into a chart as fact.
- [ ] Streaming over SSE replaces the fake step-walk timer. Parts render as they
      arrive; closing a tab cancels the server run.
- [ ] HTML artifacts render in an `iframe srcdoc` with `sandbox` (no scripts, no
      same-origin) and CSP `default-src 'none'; style-src 'unsafe-inline';
      img-src data: https:`. The server strips script tags and event handlers
      before storage. An artifact containing `<script>` and `onerror` executes
      nothing (escape test).
- [ ] One decision surface: proposal/approval parts approve inline through the
      same `decideApproval` path as the inbox; a parity test asserts identical
      resulting state. The inbox remains the canonical queue.
- [ ] Telemetry: a span per message with provider/model/reasoning/failovers
      (pool already in #22) plus per-part evals: groundedness, schema validity,
      sandbox safety.
- [ ] Session hygiene: active tab pinned; tabs idle >14 days auto-archive with
      restore; opening >8 tabs warns instead of silently sprawling.
- [ ] Guest mode keeps the same contract on the seed source, labelled demo.

## Data model sketch

```sql
ri_console.conversation (
  id text pk, workspace_id text, principal_id text, visibility text,
  scope_kind text, scope_id text, title text,
  created_at timestamptz, updated_at timestamptz, archived_at timestamptz)
ri_console.message (
  id text pk, conversation_id text, role text, parts jsonb,
  provider text, model text, reasoning text, created_at timestamptz)
```

Parts are zod-validated both server-side (before storage) and client-side
(before render); the artifact part stores sanitized HTML plus a source-chip
list, never raw model output.

## How a turn works

Composer → `POST /api/session/:id/message` (SSE) → server builds the scoped
digest + hybrid RAG matches → provider pool route (explicit choice or policy) →
streamed parts → per-part validation → message persisted → client renders.
Approvals ride the existing decision path; nothing sends from a thread.

## What stays unchanged

Octo remains canonical for facts, evidence, files, RAG, graph. The approval
inbox keeps sole decision authority. Evidence rules and private-by-default
tenancy are untouched. Keys stay server-side; the browser talks only to
same-origin routes. The source seam means guest and owner share one contract.

## Verification plan

Playwright, guest and owner: two parallel tabs with different pinned scopes
(isolation assertion); reload resumes tabs; inline approve equals inbox approve
(state parity); artifact escape attempt executes nothing; SSE parts arrive
progressively through the Vite proxy (proxy must not buffer); per-part eval
spans readable via `otel/read/span_annotations`.

## Patterns borrowed, not reinvented

`Pukujan/omp-gui` for the session GUI shape; `Pukujan/hermes-agent` and
`hermes-aura` for companion warmth and ambient projection (RI-0011);
`Pukujan/paseo` for server-side multi-agent orchestration;
`Pukujan/inference-recommendation-engine` as the future price/supply advisor
behind the pool's adapter boundary.

## Risks and tradeoffs

Tab sprawl (hygiene rules above); companion noise (RI-0011 gets quiet hours and
actionable-only badges); per-tab digest cost (cache + incremental refresh);
SSE buffering through dev proxies (explicit no-buffer config); artifact export
is static only — no live artifact state.

## Open questions for the owner

1. Artifacts: template-filled first (safe, fast) with free model HTML later
   behind the sandbox, or free HTML from day one? Recommendation: templates first.
2. Cross-tab "compare" artifact: merge two tabs' findings with sources — in this
   slice or a follow-up? Recommendation: follow-up.
3. Voice decisions (Riley) land in RI-0011 with the companion; parity with tap
   decisions is an acceptance line there.

## Next action

Owner accepts this draft → file the issue packet and GitHub issue (explicit
direction required by OIO rules) → implement as its own slice after #22 merges.
