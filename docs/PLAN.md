# Full Build Plan

**Status:** accepted direction updated 2026-11-18. The primary intake path is authenticated exploration through each teammate's TinyFish sessions, not CSV import. See [COLLECTION-AND-TEAM-PLAN.md](COLLECTION-AND-TEAM-PLAN.md) for the binding ownership and slice model.

## 1. Outcome

A usable private workspace where the owner can:

1. import people and event records from official exports;
2. inspect a current person profile and its supporting evidence;
3. keep same-name people distinct and review uncertain identities;
4. correct stale facts without losing history;
5. see event participants and sponsor affiliations;
6. ask an MCP-connected agent to answer or propose research;
7. inspect current relationships and introduction paths when graph support is added.

## 2. Architecture

```text
Official exports / APIs / approved public pages
                    │
          existing importers + n8n
                    │
          typed ingestion contracts
                    │
        ┌───────────▼────────────┐
        │          Octo          │
        │ Files: source bytes    │
        │ RAG: searchable text   │
        │ Ledger: facts/evidence │
        │ Graph: read model      │
        │ DB: queues/cursors     │
        └───────────┬────────────┘
                    │
             thin typed adapter
                    │
       React + Vite relationship CRM
                    │
             MCP-connected agent
```

### Ownership boundaries

- The frontend never receives infrastructure or provider credentials.
- All Octo access goes through one application adapter with Zod-validated inputs and outputs.
- Browser code cannot import server/Octo adapter modules.
- Workspace Postgres does not contain an alternative person profile store.
- The graph is not canonical and cannot be edited as a source of truth.
- Import/research scheduling state is operational; source facts and evidence are not.

## 3. Canonical model

### Canonical records

| Record | Identity | Notes |
|---|---|---|
| Person | Octo entity UUID | Display name is not unique |
| Organization | Octo entity UUID | Legal/brand aliases are evidence-backed identifiers |
| Project | Octo entity UUID | Repository/product/initiative |
| Event | Octo entity UUID | One specific event occurrence |
| Source document | Octo file ID plus content hash | Original bytes retained where collected |
| Source record / entity mention | Stable source key + immutable payload hash + row/JSON path | An observed profile/row, not automatically a distinct human |
| Interaction | Operational record linked to participants and evidence | Owner's own meetings/messages/introductions |
| Research job | Operational record | Queue state, attempts, budget, checkpoint |
| Import run | Operational record | Source revision, counts, diagnostics, completion |

The prototype's name-based entity uniqueness is insufficient for same-name people. Slice 002 must replace name-keyed resolution with stable IDs and explicit external identifiers before multi-source imports are enabled.

### Fact model

A fact is one Octo claim with:

- subject entity ID;
- canonical statement;
- `valid_from` / `valid_to` for world validity;
- `recorded_at` / supersession for ledger history;
- structured provenance containing a controlled verb and stable source references;
- evidence links with exact locator and excerpt when available.

### Relationship vocabulary

```text
WORKS_AT
REGISTERED
RSVPED
ATTENDED
SPOKE_AT
ORGANIZED
SPONSORED
MAINTAINS
CONTRIBUTED_TO
COLLABORATED_ON
CONNECTED_TO
SAME_AS
DIFFERENT_FROM
```

`WORKS_AT` carries its own validity interval; previous employment is derived from an ended claim, and concurrent roles are allowed. `INTRODUCED` is represented as an Interaction with introducer, introducees, and occurrence time, not a generic relationship. Registration/RSVP never proves attendance; attendance needs check-in or equivalent evidence. Event series and individual editions are distinct.

Each predicate's subject/object types, direction, cardinality, symmetry, and qualifiers are defined in the slice contract before use. Symmetric relationships derive inverse adjacency in the read model rather than writing duplicate reverse claims.

`CONNECTED_TO` is not a warm introduction or a close relationship. Relationship strength is a separate evidence-backed attribute, never inferred from co-attendance alone.

### Identity model

- Each imported source record has `source_system + source_record_id`.
- External identifiers retain type, normalized value, source, and verification status.
- `SAME_AS` and `DIFFERENT_FROM` are claims, not destructive operations.
- Name + employer creates only a review candidate.
- Ambiguous records remain separate.
- Merge/split requires durable component lineage so a mistaken merge can be reversed without losing evidence.
- Merge/split changes canonical assignment through evidence-backed mapping claims. It does not rewrite historical claim subjects or detach/reattach immutable evidence to simulate a split.
- Source-version precedence and conflict handling must be explicit; encounter order cannot decide a conflict.

### Current-profile projection

A profile is a deterministic, rebuildable view of accepted, unsuperseded claims valid at the requested as-of time. It allows concurrent roles, exposes unresolved conflicts, shows evidence and staleness, and derives previous employment from validity intervals. It is never a mutable canonical profile table.

Octo `Belief` represents a perspective's stance/confidence, not human workflow approval. Research proposals and approvals are operational records; accepted facts become claims with their agent/source perspective and evidence.

## 4. Frontend surfaces

Build only the screens needed by accepted slices:

1. **People** — search, filters, current role, company, evidence status, last verified.
2. **Person** — external identities, employment timeline, projects, interests, events, interactions, source evidence.
3. **Review** — possible duplicates, conflicts, unverified facts, stale records.
4. **Events** — attendees/speakers/organizers and sponsor organizations.
5. **Research** — queued/running/completed jobs and proposed changes with approval.
6. **Graph** — added only after the underlying claims and identity semantics work.

No public landing page, LinkedIn feed, messaging system, or general website sitemap tool is part of this product.

## 5. Vertical slices

| Slice | User job | Primary proof |
|---|---|---|
| 000 Bootstrap | Open an authenticated app connected to the intended Octo workspace | Build, contracts, authorization, production smoke |
| 001 Import and profile | Import a CSV and inspect sourced person profiles | Real import + person page + evidence + idempotent re-import |
| 002 Identity and corrections | Resolve duplicates and correct employment without losing history | Merge/split lineage + supersession + historical answer |
| 003 Events and sponsors | Inspect an event's participants and sponsor affiliations | Real event view + typed relationships + filters |
| 004 Research proposals | Queue research and approve sourced changes | Agent run + evidence + review + no unsourced write |
| 005 Relationship graph | Inspect a current relationship network and path | Freshness, determinism, rebuild equivalence |
| 006 Scheduling and collection | Run bounded incremental source refreshes | Checkpoint/resume, pacing, retry and stop behavior |
| 007 Analytics | Answer aggregate sponsor/event questions | Saved dataset queries with lineage and refresh |

## 6. Automation boundaries

- Scheduling, provider calls, retries, and batch orchestration live in n8n or existing importers.
- Collection cadence and per-source limits are configuration, not model behavior.
- Raw source material is stored before extraction.
- LLM extraction produces typed candidates; it does not directly declare identity merges.
- Approved public APIs/exports are preferred.
- Authenticated browser collection is a separate owner-accepted slice; reliability includes checkpointing, incremental sync, backoff, and stopping on rate limits, CAPTCHA, or session failure. No detection evasion.
- Agent-initiated external communication is out of scope.

## 7. Scaling path

1. Single Octo workspace; batched imports; cached evidence.
2. Idempotent source keys and content hashes.
3. n8n queue mode with PostgreSQL, Redis, and bounded workers when needed.
4. Raw documents in object storage through Octo Files; structured facts in the ledger.
5. Batch graph rebuilds rather than per-record rebuilds.
6. Large historical exports in Parquet/DuckDB analytics, not one claim per raw telemetry row.
7. Add Zingg or another maintained resolver only when the volume of ambiguous matches justifies it.

## 8. Delivery rules

- Each slice has its own PDD/SDD/eval issue packet.
- The owner accepts scope and observable success before implementation.
- Independent review checks ambiguity, ownership, missing outcomes, and overbuilding.
- Public tests prove the contract; a hidden holdout varies inputs, ordering, batching, and failure timing without changing the contract.
- CI runs on the exact candidate; a green prior commit is insufficient.
- Deployment is not completion without a production smoke check.
- The final integrator reviews the complete diff, including generated ABA code, before merging.
