# UX — Screen-by-screen content contract (RI-0017 / Slice 5)

**Status:** plan. Answers "what is on each screen at each version, what UX
system, where are the charts". Companion: `PDD-WORKSPACES-ROLES.md` (flows),
`SDD-WORKSPACES-ROLES.md` (enforcement). Every component named below already
exists in `console/src`; nothing here invents a new dependency.

## 0. The UX system (what we are using, concretely)

- **shadcn/ui + Radix** primitives: `button, input, select, dialog, sheet,
  dropdown-menu, tooltip, hover-card, tabs, table, badge, avatar, progress,
  scroll-area, command (cmdk), pagination, sonner (toasts), skeleton`.
- **Design tokens** (tailwind): `surface-1/2/3`, `border`, `run` (green),
  `warn` (amber), `primary` (coral); type scale 10.5/11.5/12/13px; `eyebrow`
  caps labels; `num` tabular figures. Dark-first, one accent.
- **Navigation:** persistent sidebar (`shell/AppShell`) + workspace/project
  switchers; **⌘K = cmdk palette** for commands and jump-to; **Peek = shadcn
  `sheet`** side panel so you never leave the list you were reading.
- **Charts:** `recharts` through shadcn `ui/chart.tsx` (`ChartContainer`,
  `ChartTooltipContent`) for area/bar/line; custom `Sparkline.tsx` for inline
  7-point trends; `StrengthMeter` (common.tsx) for relationship strength;
  relationship **graph** and **mermaid** diagrams render only inside copilot
  parts (`PartRenderer`, sandboxed iframe for artifacts/mermaid) and the
  People graph view — never as decoration on list screens.
- **Density rule:** one prose sentence + at most one visual per screen at
  Glance; lists before grids; grids only at Brief+; evidence only at Deep.
- **Altitude** (`crm/AltitudeControl`, controlled state, per-view persisted):
  Glance / Brief / Deep. Presentation-only; payload identical (invariant I7).

## 1. Screen × altitude matrix

Columns: what renders at each altitude. **Charts** names the visual and where.
Every row links/peeks; nothing is a dead summary.

### Today (`/today`)
| Glance | Brief | Deep |
|---|---|---|
| prose sentence ("1 decision waiting, 1 mission due, 1 going cold"); 4 KPI tiles (`Link` cards: approvals / missions today / going cold / agents active) each with a `Sparkline`; **Needs attention** as ≤3 one-line rows (`RollupSignal` flattened: label · detail · link) | + `UnifiedTimeline variant="strip"` (Next 7 days); + three working cards: My approvals (approve/decline inline), Missions due today, Going cold (`StrengthMeter`) | + Your team panel (`AgentCard` grid); + activity/evidence per attention item; + `PortfolioTable` of projects |
Charts: 4 inline sparklines (Glance); strength meters (Brief); portfolio bars (Deep). Peek: any attention row → mission/person brief. Empty: "Nothing needs you. Ask the copilot to find the next move." + one button.

### Approvals (`/approvals`)
| Glance | Brief | Deep |
|---|---|---|
| count + highest-risk one-liner; list of pending as single rows (agent avatar, title, risk `Badge`, age) | + full proposal cards: reason, evidence chips, proposed action, approve/decline | + diff of what approval materializes (mission/plan steps), activity trail, re-plan history |
Charts: none (decisions are text). Peek: row → proposal sheet. Empty: "Inbox zero. Agents queue nothing without you."

### Projects (`/projects`) / Project detail (`/projects/:id`)
| Glance | Brief | Deep |
|---|---|---|
| portfolio as rows: name, owner chip, status `StatusPill`, next deadline, one sparkline of mission completion | + `PortfolioTable` (sortable columns) + objective progress bars (`Progress`) | + mission/plan tree, evidence links, activity, delete affordance (role-gated), `UnifiedTimeline` of the project |
Charts: completion sparkline (Glance), progress bars (Brief), timeline (Deep). Header: `New project` at all altitudes; switcher footer + ⌘K too.

### Objectives / Missions / Plans (list + detail)
| Glance | Brief | Deep |
|---|---|---|
| rows: title, parent project chip, due, status; overdue tinted `warn` | + grouped-by-project sections, owner avatars, step counts | + step checklist with evidence per step, re-plan button (stalled/blocked only), activity |
Charts: due-date heat strip (Brief, recharts bar of counts/day). Peek everywhere.

### People (`/people`) / Person profile (`/people/:id`)
| Glance | Brief | Deep |
|---|---|---|
| rows: avatar, name, company, strength meter, days-quiet; going-cold tinted | + filters (company, warmth, tag) + `UnifiedTimeline` of last touches | + claim/evidence list with sources, relationship graph neighbourhood (custom SVG), notes, missions touching them |
Charts: `StrengthMeter` (Glance), touch timeline (Brief), graph (Deep). Graph is evidence, not decoration: edges labelled, sources cited.

### Calendar (`/calendar`) / Events (`/events`)
| Glance | Brief | Deep |
|---|---|---|
| month grid with dots only + "next: <title> <date>" one-liner | + `UnifiedTimeline strip` for the month + day agenda list | + meeting notes linked to people/project, prep button per event |
Charts: dot density is the visual; no axes at Glance.

### Agents (`/agents`) / Agent detail
| Glance | Brief | Deep |
|---|---|---|
| rows: avatar, lane, status pill, runs-today count | + `AgentCard` grid with sparkline of runs/7d | + run history table, eval scores (recharts bar), prompt/policy view, pause |
Charts: runs sparkline (Brief), eval bars (Deep, `ChartContainer`).

### Activity (`/activity`)
Glance: last 5 events one-line. Brief: full filterable feed. Deep: + per-event payload/evidence. Charts: none.

### Copilot (`/copilot`)
Not altitude-gated (it is the research surface): thread rail (search +
`pagination`-style Show more), typed parts via `PartRenderer` — **this is where
the rich charts live**: `kpi`, `sparkline`, `table`, `graph`, `timeline`,
`mermaid`, `tree`, `image`, sandboxed `artifact`, `proposal`, `approval`,
`actions`. Context panel keeps the scoped graph visible. Every chart part
carries evidence chips; unsourced = labelled unverified.

### Profile & team (`/profile`)
Glance: your card + team count. Brief: team table with **role badges**
(owner/admin/operator/member) + pending invites. Deep: invite dialog, role
change, revoke; your resume/goals/telemetry links. Charts: none.

### Schedules (`/schedules`)
Glance: next-run one-liner + active count. Brief: schedule rows (cadence,
scope, next run, pause/delete). Deep: run queue with statuses. Charts: none.

### Knowledge (files / notes / retros)
Glance: counts + last-touched rows. Brief: folder tree / note list with
visibility badges (mine/team/shared). Deep: preview, links to graph entities,
retro diff. Charts: none.

### Integrations (connectors / mcp / plugins)
Glance: connected count + health dots. Brief: connector rows with honest
badges (live / proof-only / needs-owner-action) + test buttons. Deep: scopes,
keys metadata (never secrets), logs. Charts: health dots only.

### Voice (`/voice`)
Unchanged LiveKit edge: call button, device check, transcript. No altitude.

### Sign-in / Join (`/signin`)
Google button (our own OAuth), guest demo, and — when signed in but not a
member — the join screen: "no workspace has invited you" + Create workspace /
Copy my email. Never an empty dashboard.

## 2. What changes per slice (screen deltas)

1. **Slice 1 (tenancy):** switcher lists only memberships; foreign workspace
   requests 403 → join screen; role badges appear (read-only).
2. **Slice 2 (workspaces):** switcher footer "＋ New workspace…"; empty-state
   Today with three actions.
3. **Slice 3 (invite/join):** switcher footer "Invite teammate…"; Team pending
   rows; teammate lands in their workspace.
4. **Slice 4 (role-gated writes):** delete/invite/decide hidden or
   disabled-with-reason per matrix; second decide = clean 409 toast.
5. **Slice 5 (this doc):** Today/Projects/Calendar/etc. re-layered to the
   matrix; Glance becomes genuinely glanceable; `pagination` primitive used
   for long tables; ⌘K gains New project / New workspace / Invite commands.

## 3. Acceptance for Slice 5 (patchright, relation U1–U3)

- Glance Today DOM contains ≤3 attention rows, zero card grids, zero
  timelines; Brief adds exactly the strip + three cards; Deep adds team +
  evidence. World payload byte-identical across the three.
- Every Glance row is a link or opens Peek.
- Charts appear only where this matrix names them; no chart without a source
  chip in copilot parts.

## 4. Competitive borrowings (researched 2026-11-19, sources cited)

Nobody ships the whole combination (evidence-canonical graph + agents +
approval-gated outbound + research copilot). On individual axes, borrow:

1. **Cadence, not silence** (Cloze/People.ai): going-cold threshold per
   relationship stage/segment; connectors auto-write touches so the timeline
   fills itself. Slice 6.
2. **Agenda-thinking Glance** (Sunsama/Motion): Today Glance becomes "your 3
   moves today" + one sparkline row, replacing four dashboard tiles. Slice 5.
3. **Saved views + inline edit** (Attio): PortfolioTable gains saved views,
   column config, optimistic inline edit. Slice 6.
4. **Enrichment as table columns** (Clay): per-row research action with a
   source waterfall; results land as evidence chips, never silent facts. Slice 6.
5. **Intro paths** (Affinity): Person→Deep "who can introduce me" —
   strength-weighted path query over the graph, edges labelled and sourced. Slice 6.
6. **Do/Don't + decline path** (Zapier approval steps): approval cards show
   Do / Don't and what a decline does (stop vs re-plan); keyboard triage
   (j/k, a, d, e) with optimistic updates (Linear). Slice 4.
7. **Follow-up chips + sources panel** (Perplexity/Claude artifacts): each
   thread ends with 2–3 suggested follow-ups and a collapsible sources list. Slice 5.

Cautionary: Relay.app shut down 2026-09 — approvals must live inside the work
surface, not as a standalone automation product. Mobile and passive capture
remain honest gaps; neither is faked with seed data.

Sources: affinity.co/blog/crm-network-mapping; getdex.com/blog/cloze-crm-review;
theaiagentindex.com/agents/clay; producthunt.com/products/attio/reviews;
sunsama.com/blog/best-to-do-list-and-daily-planner-apps;
rills.ai/blog/zapier-human-approval-step; relay.app; people.ai; linear.app.
