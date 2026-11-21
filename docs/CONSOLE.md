# The Console — product goal, operating model, and UX map

**Status:** accepted direction from the owner, 2026-11-19. This defines the product
surface of Relationship Intelligence: the console where a person directs a team of
AI agents that work their relationships. It does not change the canonical rules in
[PROJECT.md](../PROJECT.md) — Octo stays canonical, facts stay evidence-backed, and
the human stays in control.

## 1. Goal and milestone

**Goal.** Give one person a calm command center where AI agents help them figure out
what to do, do the work, and keep every relationship and every task from going quiet —
while the person always makes the decisions.

**Milestone.** Turn a scattered professional network (people, companies, events, deals)
into a living, evidence-backed graph, and put a team of specialized agents to work on
it: researching, drafting, following up, and surfacing opportunities. The agents carry
the execution and the thinking-heavy prep; the human carries the judgment.

The product answers, at a glance: *what needs me today, who is going cold, what are my
agents doing, and what should I do next?*

**The bet.** Defining the work — naming a milestone, writing a sharp objective, researching
what it should be — is harder than executing it. So the agents lead with helping you
*figure out what to do*, not just doing what they're told. That is the differentiator.

## 2. Operating model — the trust layer

Three principles make the agents usable instead of dangerous.

**Propose, don't decide.** The agent is a thinking partner. It talks a decision through,
lays out options with evidence and tradeoffs, recommends one and says why — then the
human picks. Nothing sends, calls, publishes, or commits without consent. This is the
existing autonomy model (`draft` / `approve` / `full`) plus the approval gate, and it
extends [PROJECT.md](../PROJECT.md) rule 8: agent output is a proposal until accepted.

**Deadlines and iteration — no silent stalls.** Work moves in a loop, not a straight line:

```text
execute → detect stall → propose a way forward → human approves → continue
```

Every milestone and objective has a deadline. If something is blocked, overdue, or has no
progress for a set window, the agent surfaces it ("this is stuck because X") and proposes
the adjustment — re-plan, break it smaller, try an alternative, or escalate a decision.
A stall becomes a proposal, never a dead end. Periodic nudges report progress against the
deadline so nothing drifts without a signal.

**Signals as data — state always legible.** Make state readable at a glance: deadline
countdowns, progress-vs-time, overdue/stalled badges, relationship-decay indicators,
sparklines, status pills, KPI deltas. One aggregated "needs attention" layer collects
*needs a decision / overdue / stalled / going cold* so the human never hunts. The rule:
no silent failures — if an agent can't move, you see it immediately, with a next step.

## 3. Structure and UX map

**Reframe.** From "watch the agents" to "organize your work; the agents execute it."
Agents are the workers, not the whole structure.

**Container switcher (the boundary).** Top of the sidebar:
`Organization ▾ · Workspace ▾ · Project ▾`. This is the tenancy/context boundary, not a
nav tab. Switching project scopes the work views.

**Grouped navigation.** Each section is one kind of thing:

```text
TODAY            personal front door: my approvals, milestones due today, going-cold
INBOX            the approval queue (badge), kept separate
WORK             Projects · Objectives · Plans · Milestones
RELATIONSHIPS    People · Companies · Events   (the graph)
CALENDAR         month/week view of events + meetings + dated milestones
AGENTS           the workers; Sales / Marketing / Research nested as specializations
KNOWLEDGE        Files & Folders · Notes / Meeting notes · Retrospectives
INTEGRATIONS     Connectors · MCP servers · Plugins
```

**Work hierarchy.** `Project (mission) → Objective → Milestone → (Plan + Tasks)`:

| Level | Meaning |
|---|---|
| Project | container — a deal, event, or initiative |
| Mission | the project's enduring purpose — why it exists; never time-boxed, never "done" |
| Objective | a bounded, measurable goal inside a project, with a target and a deadline |
| Milestone | a bounded, time-boxed unit (daily/weekly) agents execute to advance an objective |
| Plan | the agent's strategy/steps for a milestone |
| Task | an atomic step within a milestone |

The mission is the why; objectives and milestones are the bounded what/when. Persisted
Octo kinds and keys keep the legacy `mission` spelling for the milestone unit
(`ri_console.mission`, plan/task `missionId`, design `missionName`/`missionSummary`);
the console domain and every human-facing surface say milestone.

Projects and milestones **reference** people/events from the graph; they never own or
duplicate them. A person lives in the graph once and appears in every project/milestone
that references them. That is the graph payoff.

**Relationships are a graph, not folders.** People/companies/events are organized with
tags and saved smart lists ("Going cold", "Aster sponsors"), not folder trees. Folders
are for work (projects/milestones) and documents, not for people.

**Entry.** A sign-in screen: "Continue with Google" (Octo auth, loads the user's
workspace) and "Continue as guest" (a clearly-labeled demo of the seeded world). Sign-out
returns here.

**Design language.** Dark, warm, premium — Linear density, Clay warmth, Lindy agent
cards. shadcn tokens, calm grouped sidebar, keyboard-first with ⌘K copilot everywhere,
accessible loading/empty/error/success states, responsive down to phone (inbox + copilot
especially).

## 4. Intelligence layer — the research agent

The copilot is one orchestrator over the agents, reachable by typing, voice, or a phone
call (three surfaces on one brain). Beyond routing, it runs a **research / design mode**:

1. **Research.** Given a vague goal, pull the relevant people/companies/events, claims,
   evidence, and recent activity from Octo's graph + RAG; use web research when the graph
   is thin.
2. **Propose.** Suggest milestone names, draft a measurable objective, outline a plan,
   assign the right agent(s) and autonomy, and flag what's unverified.
3. **Hold for approval.** The human edits/accepts before it becomes work.

This is the "help me figure out what to do" capability: naming, objective-drafting, and
research are the agent's job; judgment is the human's. It composes with the trust layer —
every proposal is gated, every stall is signalled, every deadline is tracked.

## 5. Data model and multi-tenancy

**Objects.** `Agent, AgentTask, AgentRun, Approval, ActivityEntry` plus
`Person, Company, RelationshipEvent, Claim`, extended with `Project, Objective, Milestone,
Plan`. Every claim carries a source, confidence, and `sourced`/`unverified` status;
nothing unsourced becomes canonical.

**Multi-tenancy.** Organization → workspace → project is the container boundary. Real
tenancy comes from Octo: a workspace per team, a principal per teammate, and the
private/shared split from [COLLECTION-AND-TEAM-PLAN.md](COLLECTION-AND-TEAM-PLAN.md).
Personal/private is the default (my notes, drafts, relationships, agents' output);
approved records are explicitly promoted to the shared team workspace. The frontend reads
through one swappable data-access module, so tenant scoping is injected without touching
screens.

## 6. How it composes

- **Octo** — canonical entities, claims, evidence, files, RAG, and the FalkorDB graph; the
  workspace SQL surface for operational records; MCP for agent tool access.
- **Collector** — the local daemon from [COLLECTION-EXECUTION.md](COLLECTION-EXECUTION.md)
  feeds sourced observations into the graph via each teammate's own connectors.
- **Voice/phone** — reuse the Riley LiveKit agent (`Pukujan-lab-2/nurse-screen`) so
  "Call me" reads the approval inbox and takes voice decisions; a call is the orchestrator
  on a voice channel, and voice decisions land in the inbox and timeline like taps.
- **Frontend** — ABA-generated React + Vite + shadcn; Nitro only as the thin
  session/credential adapter, per the stack decision.

## 7. Built vs. next

Built: the six core surfaces and the restructure to grouped nav, work hierarchy,
sign-in/guest, and integrations (ABA, seeded). On top of that, the intelligence
layer: a server-side copilot orchestrator over the model gateway (answers
validated and grounded to real world ids, with a labelled offline fallback), a
research/design mode that proposes milestone + objective + plan held for approval,
the deadline/iteration loop (stalled milestones produce re-plan proposals), and the
aggregated signal layer on Today. Owner mode reads canonical people/companies/
claims from Octo's ledger via the graph projection and operational records from
the workspace SQL surface, always with the signed-in principal's token; guest
mode stays on the labelled seed. Copilot calls export OTLP spans and CODE eval
scores to the workspace's Octo-hosted Phoenix project.

Hybrid RAG is now fed: `scripts/seed_rag.py` ingests sourced claims (with their
evidence locators) from the canonical ledger into Octo RAG; the copilot's
`/api/rag/query` call now carries evidence locators and excerpts into the digest,
and the production entry point passes the Octo credentials to the copilot server.
Graph health is checked on each world read and staleness is surfaced in the UI.

Raw source bytes can be uploaded to Octo Files with `scripts/seed_files.py`
(idempotent by content hash) once a connector's raw capture directory exists;
no source bytes are bundled in the repository.

Next, in order: (1) real voice/phone via Riley; (2) production static serving of
the console under the app origin and the private→shared promotion flow; (3) the
identity review and graph-exploration slices from the program; (4) typed claim
relations and identity resolution in the reader/writer, bitemporal as-of views,
and moving the RAG query behind the signed-in adapter. Each lands as its own
accepted slice with real user-flow verification.
