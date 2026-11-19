# Authenticated Collection and Team Access

**Status:** accepted direction from the owner, 2026-11-18. Replaces the CSV-first intake plan.

**Execution proposal:** [COLLECTION-EXECUTION.md](COLLECTION-EXECUTION.md) proposes running collectors on each teammate's own machine instead of cloud browser profiles, with device identity added to `source_connection`. Awaiting owner acceptance in [issue #15](https://github.com/Pukujan/relationship-intelligence/issues/15); the ownership and workspace rules below are unchanged either way.

## Outcome

Teammates sign into the same application with their own Google accounts. Each teammate connects their own TinyFish account and authorizes their own LinkedIn, X, Gmail, and Luma sessions. A durable research plan turns those sources into evidence-backed people, organization, event, project, and interaction records in Octo.

No CSV import is required for the primary workflow. Export ingestion remains an optional adapter, not the product's foundation.

## Four identities, kept separate

| Identity | Owned by | Used for |
|---|---|---|
| Application account | Individual teammate | Google sign-in and application session |
| Octo principal + membership | Individual teammate | Workspace authorization and attribution |
| TinyFish account + Browser Context Profile | Individual teammate | Persistent source-site sessions and collector runs |
| Source account | Individual teammate | LinkedIn, X, Gmail, Luma, and calendar access |

A teammate must never inherit another teammate's source session. A shared application login or shared TinyFish profile is not a valid implementation of team access.

## Workspace layout

```text
Application deployment
  ├── owner Google account ── owner Octo principal
  │     └── owner TinyFish profiles ── owner source accounts
  │
  └── teammate Google account ── teammate Octo principal
        └── teammate TinyFish profiles ── teammate source accounts

Octo shared team workspace
  └── approved shareable people/company/project/event claims + evidence

Octo per-person private workspaces
  └── raw mail/calendar captures, private interaction notes,
      personal collection cursors, and private source observations
```

The application adapter must enforce both Octo workspace membership and source ownership. It must not expose a shared Octo workspace key to the browser. A backend credential alone is not a substitute for checking the signed-in principal and the record's source owner.

Private source data is not made team-visible merely because its collector ran in a shared deployment. Only explicitly approved records are promoted into the shared team workspace.

## Durable application records

These are operational/configuration records in Octo workspace Postgres, not a second person-profile database:

| Record | Ownership | Purpose |
|---|---|---|
| `app_user` | Application principal ID | Maps Google identity to Octo principal |
| `workspace_membership` | Workspace + principal | Cached verified role and membership state; Octo remains authoritative |
| `source_connection` | Principal + provider + source | TinyFish account reference, profile ID, sites, status, scopes; no raw session cookies |
| `source_session_check` | Source connection | Last verified time, outcome, and failure category |
| `collection_plan` | Principal + workspace | Seed URLs, source policy, schedule, limits, and traversal rules |
| `collection_run` | Plan + principal | One execution with provider run ID, state, budget, and timing |
| `collection_task` | Run + normalized URL | One page/section/action with depth, status, attempts, and checkpoint |
| `source_record` | Principal + source + native ID | Immutable observed profile/post/message/event payload reference |
| `identity_candidate` | Source records | Possible match requiring review, never automatic merge |
| `research_proposal` | Principal + run | Extracted facts and evidence awaiting approval |
| `audit_event` | Principal + workspace | Connection, approval, publish, and authorization decisions |

Canonical user-visible facts remain in Octo's epistemic ledger. Raw pages/messages remain in Octo Files; searchable text uses Octo RAG; graph state remains a rebuildable projection.

## Collector execution

A `collection_plan` contains named source-specific tasks. It is not one generic prompt that wanders a website.

| Source/task | Bounded exploration |
|---|---|
| LinkedIn profile | Verify identity; scroll configured sections; expand entries; inspect experience, education, projects, and visible public links |
| LinkedIn activity | Inspect configured recent visible posts/articles; paginate within the run's limit |
| LinkedIn organization | Overview, public affiliations, organization links, and configured people/activity sections |
| X profile | Profile metadata, configured recent visible posts, and public affiliations |
| Luma event | Event edition, organizers, description, links, registrations/RSVPs, sponsors, and related public pages |
| Gmail | Explicit query/window; message IDs, participants, signatures, event notices, and introductions relevant to the plan |
| Calendar | Explicit time window; event details, participants, location, organizer, and source event ID |

Each task has a URL, action, output schema, depth, retry/checkpoint state, and stop condition. Newly discovered URLs become queued tasks only if they match the plan's source/depth rules.

## Collection state machine

```text
draft plan → owner starts run → validate source ownership/session
  → lease one task → execute in owner's TinyFish profile
  → save raw observation → extract typed candidates → checkpoint
  → next task, complete, pause, or stop for review
  → identity/fact review → approved claims → shared workspace
```

A task cannot silently become another teammate's task. Retry uses the same source connection and stable idempotency key. A changed session or provider run cannot be assumed to have completed; inspect its actual status before retrying.

## Source setup

The previously issued TinyFish CLI-generated setup URL produced a dashboard 404. Do not use it as evidence of a saved session.

Current TinyFish documentation routes manual setup through **TinyProfiles** at <https://agent.tinyfish.ai/profiles>. Setup and verification are recorded as explicit application states:

```text
not_connected → setup_required → verifying → connected
                                      └────→ expired/reauth_required
```

The application stores the TinyFish profile ID and provider references, not cookies, passwords, one-time codes, or raw browser state. A collector cannot start until it verifies both the expected profile and the requested source's saved sign-in.

## Frontend order

1. Google sign-in and workspace/member selection.
2. Connections screen: TinyFish plus per-site session status for the signed-in teammate.
3. Plans screen: seed URLs, sources, limits, schedules, and owner.
4. Runs screen: visible steps, current page/section, checkpoints, errors, and stop/resume.
5. Review screen: extracted observations, identity candidates, and share/publish approval.
6. People/event/graph views built from approved Octo records.

The first implementation slice is the authenticated shell plus a durable `source_connection` and `collection_plan` configuration. Actual profile exploration follows in the next collector slice.

## Revised slice sequence

| Slice | Outcome |
|---|---|
| 000 | Google-authenticated multi-user app, Octo membership, isolated source ownership |
| 001 | Durable TinyFish/source connections and collection-plan configuration |
| 002 | LinkedIn profile exploration with scrolling, section expansion, raw evidence, checkpoints, and resume |
| 003 | Luma/X exploration and person/organization/event identity review |
| 004 | Gmail/calendar private interaction ingestion with explicit scopes and time windows |
| 005 | Research queue, agent proposals, and shared-workspace publication |
| 006 | Relationship graph/current-profile views and freshness verification |
| 007 | Scheduled incremental collection and historical analytics |

## Verification boundaries

- Teammate A cannot read or run teammate B's source connection, even by guessing IDs.
- Revoking Octo membership prevents further data access even if the application session remains open.
- A run stopped after each task resumes without duplicating canonical observations.
- An expired session stops the affected source without disabling other teammates' sessions.
- Gmail/calendar observations stay private until explicitly published.
- The application never logs provider secrets, session cookies, mailbox bodies in test fixtures, or one-time codes.
- Real collector acceptance uses a saved test session and a small declared profile/event fixture, not synthetic screenshots alone.
