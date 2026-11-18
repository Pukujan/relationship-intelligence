# Validation and Verification Contract

## Principle

Each test proves a named product or data property. Lint, type checking, screenshots, and unit tests are supporting evidence, not end-to-end completion.

Every slice issue contains PDD, SDD, and eval sections and links each acceptance criterion to at least one test or production observation.

## Layers

| Layer | Tool | What it proves |
|---|---|---|
| Format/lint | Biome for TypeScript | Deterministic style and selected static defects |
| Types | `tsc --noEmit`, strict mode | Type correctness across app, adapter, tests, scripts |
| Legacy Python | Ruff format/check + mypy | Existing importer quality without rewriting it |
| Runtime contracts | Zod | API/import/environment/persisted payload validation |
| Fixture schema | JSON Schema generated from Zod + AJV | Valid/invalid committed fixtures and schema drift |
| Unit/property | Vitest + fast-check | Canonicalization, reducers, state transitions, invariants |
| Integration | Real Octo test workspace/providers | Actual API, persistence, authorization, provider assumptions |
| End to end | Playwright | Accepted user journeys through the real UI |
| Architecture | dependency-cruiser | No cycles and no browser-to-server/Octo boundary bypass |
| Orphans | knip + explicit script/CI entry points | No unreachable files, exports, or dependencies |
| Process | OIO validation/triage + packet/traceability check | Valid issue logs and linked acceptance evidence |
| Delivery | GitHub Actions required checks | Exact-candidate verification |

Use one TypeScript formatter/linter: **Biome**. Do not also run ESLint/Prettier as competing formatters.

TypeScript settings include `strict`, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes`.

For legacy Python, use a checked-in ratchet/baseline rather than lowering rules for new code. New application/adapter code is TypeScript.

## Contract validation

Validate at trust boundaries, not only with TypeScript annotations:

- import rows and source records;
- Octo API requests/responses and error envelopes;
- environment configuration;
- research proposals;
- persisted operational records read back from the database;
- MCP adapter inputs/outputs.

Pin supported Octo versions. Consumer contract tests must run against a real supported Octo instance in protected CI; mocks alone do not establish provider compatibility.

## Required global invariants

1. Importing the same source revision repeatedly creates no duplicate canonical facts or graph effects.
2. Source row order and import batch size do not determine canonical state.
3. Conflicting records follow explicit source precedence or are rejected; encounter order never wins silently.
4. Another workspace's imports, identities, cache, and graph never change this workspace's answers.
5. Name + employer never merges people.
6. Merge/split preserves source mentions, evidence, and historical claim assignments.
7. Supersession preserves the old claim and its evidence as non-current history.
8. A current/as-of profile never silently selects an unresolved conflict by latest arrival.
9. Rebuilding a graph from the same ledger/version produces equivalent nodes, edges, and answers.
10. An acknowledged write is either reflected in graph answers or the response explicitly reports staleness/pending projection.

## Metamorphic relations

Compare canonical domain state, excluding operational run IDs and timestamps unless the property concerns them.

| ID | Transformation | Required relation |
|---|---|---|
| MR-I1 | Import identical source twice | Same canonical state as one import; only audit receipts may differ |
| MR-I2 | Change batch size, retry batches, repeat empty batches | Same final canonical state as exactly-once import |
| MR-I3 | Permute input rows | Same canonical state and stable-row diagnostics |
| MR-W1 | Interleave unrelated workspace B operations | Workspace A state and answers unchanged |
| MR-ID1 | Merge two identities | Current view includes exactly the union of supported claims/evidence; no support is invented |
| MR-ID2 | Split a prior merge using recorded components | Original canonical assignments and historical views are recoverable |
| MR-C1 | Supersede a claim | New current claim; old claim/evidence remain historical |
| MR-C2 | Replay a revision or deliver an older revision late | Current winner unchanged under declared precedence |
| MR-G1 | Rebuild the same graph twice | Equivalent canonical nodes, edges, and answers |
| MR-G2 | Rebuild after import/merge/split/supersession | Equivalent to a fresh rebuild from the resulting ledger |
| MR-G3 | Query after acknowledged write before projection | Explicit stale/pending response, never unlabeled stale success |
| MR-P1 | Render profile at an earlier as-of time | Later corrections do not rewrite that historical answer |

Octo owns projection from ledger rows. MR-G2 does not require Octo to implement an incremental projector; this application's incremental read model, if one is added, must equal Octo's fresh rebuild.

## User-flow tests

Use Playwright for critical journeys only:

- import a real fixture and open a person;
- open evidence for a displayed fact;
- review a same-name candidate without merging it;
- correct an employer and inspect the previous role;
- filter an event roster by participation role;
- review and approve/reject a research proposal;
- see and explain a stale graph state.

Set up data through APIs, isolate workspaces, wait on observable states rather than fixed sleeps, and retain traces on failure. Test authorization with direct API calls and ID guessing, not only hidden buttons.

## CI gates

### Pull requests

```text
locked install
→ Biome check
→ tsc strict
→ Ruff + mypy for active Python paths
→ schema/fixture validation
→ unit + fast-check
→ dependency-cruiser + knip
→ production build
→ focused Playwright
→ slice packet/acceptance traceability check
```

### Protected integration jobs

Real Octo/provider contract tests use protected credentials. They do not run with secrets on untrusted fork PRs.

### Main/nightly/release

Larger property budgets, supported Octo versions, broader browser coverage, selected fault injection, and private holdouts where declared.

Retries must not turn a flaky failure into a silent pass.

## Hidden holdout

Freeze success criteria before reading holdout data. Vary:

- unseen valid fixtures and names;
- duplicate/conflict patterns;
- row order and batch boundaries;
- workspace interleavings;
- merge/split histories;
- graph projection timing and cache state;
- selected failure points within the declared envelope.

Do not introduce unsupported formats, new semantics, a new Octo major version, or stricter thresholds. Convert a holdout failure into a reproducible public regression fixture without changing the original success criterion.

## Explicitly deferred

- Pixel-perfect visual gates while UX is changing.
- Large DOM snapshots and universal browser matrices.
- 100% coverage targets, broad mutation testing, and load benchmarks without an SLO.
- Rewriting working legacy importers merely for stack uniformity.
- Treating Octo's own tests or production availability as this application's correctness oracle.
