# UX Research Memo — Relationship Intelligence Console (RI-0017 / #42)

**Status:** Draft ready for owner review and sign-off.
**Gate:** Blocks redesign slices [RI-0014 (#39)](issues/RI-0014.md), [RI-0015 (#40)](issues/RI-0015.md), and [RI-0016 (#41)](issues/RI-0016.md). Does **not** block correctness/security slices [RI-0012 (#37)](issues/RI-0012.md) or [RI-0013 (#38)](issues/RI-0013.md).
**Companion docs:** [CONSOLE.md](CONSOLE.md), [PDD-WORKSPACES-ROLES.md](PDD-WORKSPACES-ROLES.md), [SDD-WORKSPACES-ROLES.md](SDD-WORKSPACES-ROLES.md), [UX-SCREENS.md](UX-SCREENS.md), [VALIDATIONS-WORKSPACES-ROLES.md](VALIDATIONS-WORKSPACES-ROLES.md).

---

## 1. Executive Summary

The owner's "way too much on screen" feedback exposed a structural mismatch: the prototype was designed **screen-first** (15 top-level CRM views, with Glance rendering Brief-level card grids), whereas the real product is a **consent-first chief of staff** over Octo's epistemic memory.

This memo establishes the UX contract before any redesign code lands:
1. Collapse daily human navigation from 15 competing screens to **5 daily human surfaces** (Today Agenda, Approvals Queue, Copilot Stage, People/Graph, Voice/Phone), keeping the remaining 10 views secondary (`⌘K`, Peek drawers, or agent-driven navigation).
2. Anchor every flow and evaluation on a **real owner week** (Jenny Liu + GISMO NYC GeoAI Hackathon / NYU GIS Day / MTA NaviLens follow-up + Design Bakery growth).
3. Define **scoped-memory ingestion, deduplication, superseding, and TTL** so pasting mixed chats or syncing mail/voice never causes project bleed or context rot.
4. Make the web console an **agent-guided visual stage** (typed frontend tools + DOM spotlighting) paired with zero-screen voice (Riley), ambient dictation (Wispr Flow), and consent-gated local action runners (Luma RSVPs, LinkedIn posts/replies).
5. Verify redesigns autonomously **for human UX** (goal-driven synthetic persona simulations + multimodal VLM heuristic audits), calibrated against weekly real usage and two teammate interviews.

---

## 2. Canonical Real-World Scenario (Nov 12–19, 2026)

Every redesign slice and UX evaluation must pass against this real multi-channel scenario rather than synthetic placeholder records:

### Timeline & Signals
- **Nov 12–13:** Prep meetings with Jenny Liu (`NYC map agent meeting with Jenny` via Google Meet; in-person at Fulton St).
- **Nov 14:** Won **Best Overall GeoAI Solution** as **Design Bakery** (Pujan Bajracharya, Jenny Liu) at **GISMO NYC GeoAI Hackathon 2026** (NYU Bobst Library).
- **Nov 15:** Jenny forwarded Devpost / Hermes Plugin Hackathon resources (`jliuhack@gmail.com`) proposing parallel growth-hack brainstorming (influencers / donors) and Ravi Mehta UXD mentoring info.
- **Nov 17–19 (LinkedIn & Email):** Post celebrating the GeoAI win received comments from Chrys Li + 7 others; Snigdha Anantharaju, Kristin Scholten, Rebeca Valbuena, and Nalini Kantheti accepted LinkedIn invites; Alok Sachan sent a LinkedIn DM; Him Mistry sent the NYU GIS Day 2026 presenter thank-you (82+ attendees).
- **Nov 18 (NYU GIS Day 2026, 370 Jay St):** Presented 3rd in lineup (shifted from 1st); Jenny prepared `Level5_walk_faces_blurred.mp4` for 14th St station. Same evening, Pujan applied to **Techstars**.
- **Nov 19 (Mixed Discord DM with `MsSiLEPai` / Jenny Liu):** One single thread mixed:
  - **`project/nyc-map-agent`:** Jenny attended an MTA accessibility presentation and got a warm MTA contact open to scheduling a follow-up. MTA has a $2M US DOT SMART Grant for NaviLens accessible wayfinding (currently limited to the 6 train in Manhattan/Bronx) and lacks staff to collect/map stations. Also station wayfinding notes (Chanin Bldg, Cortlandt 4/5 elevator, Fulton→WTC ramp).
  - **`project/design-bakery-growth`:** Techstars application, PR distribution tools (PRLog, EIN Presswire, EZ Newswire), Techstars Foundation / Matt Kozlov, OAR $15K community grant (redesigning post-2025).
  - **`project/relationship-intelligence`:** Positioning an epistemic-ledger-backed research agent vs. ChatGPT.
  - **`person/jenny-liu` rapport & discardable banter:** Mixue matcha, Salswee mango desserts, pizza, *The Altruists* / SBF joke, "on the train".
- **Upcoming Luma events:** NYC Non-Slop Hackathon (Sun Nov 22, pending host approval), Fractal Weekly Demo Party #14 (Wed Dec 2, invite open), SMART LIFE Experience (Sun Nov 22, invite open).

### Four Day-in-the-Life Storyboards
1. **8:30 AM — Morning Glance (2 min):** Opens `/today` at Glance. Sees 1 prose sentence + **Your 3 Moves**: (1) schedule MTA NaviLens follow-up via Jenny, (2) reply to GIS Day thank-you & LinkedIn commenters/DM, (3) decide on Dec 2 Fractal Demo Party Luma invite. Zero card grids.
2. **11:45 AM — Pre-Meeting Brief (30 sec):** Before calling Jenny or the MTA contact, asks Riley by phone or clicks Peek on the person/project. Gets a 5-bullet sourced brief: last touch, MTA $2M SMART Grant context, NaviLens 6-train gap, and `Level5_walk_faces_blurred.mp4` asset. Zero Techstars or Hermes notes bleed in.
3. **2:10 PM — Post-Meeting Capture (60 sec):** Walking out of a meeting with no laptop, dictates via Wispr Flow or calls Riley for 45 seconds. Agent writes dated claims into private Octo memory, updates relationship cadence, and queues a follow-up draft for approval.
4. **4:30 PM — Agent-Guided Console Walkthrough (3 min):** In `/copilot`, says *"Walk me through my GIS Day follow-ups and stage the MTA intro."* The agent navigates to `/approvals`, spotlights each staged card with Do/Don't consequences, opens Jenny's identity-merge review (`MsSiLEPai` + `jliuhack@gmail.com` + `msjennyliu2@gmail.com`), and stops at the human Approve button.

---

## 3. Answers to All 8 Open Research Questions

### Q1. Agenda-vs-tiles Glance & 15-Screen Collapse
- **Recommendation:** Adopt **Sunsama-style agenda Glance** ("1 prose sentence + 3 moves + 1 compact sparkline row, zero card grids") and collapse daily human navigation to **5 daily surfaces**:
  1. **Today (`/today`)** — Agenda front door (Glance/Brief/Deep).
  2. **Approvals (`/approvals`)** — Unified consent queue (staged actions, identity merges, mission plans).
  3. **Copilot Stage (`/copilot`)** — Persistent chat/voice orchestrator with sourced visual parts and UI control.
  4. **People & Graph (`/people`, `/people/:id`)** — Sourced profiles, cadence, warm intro paths.
  5. **Voice / Phone (`/voice` + phone call)** — Zero-screen LiveKit/Riley channel.
- **Secondary views (10):** Projects, Objectives/Missions/Plans, Calendar/Events, Agents, Activity, Schedules, Knowledge, Integrations, Profile & Team, Sign-in/Join remain intact as routes reachable via `⌘K`, Peek drawers, sidebar collapse, or agent navigation.

### Q2. Scoped-Memory Ingestion, Deduplication & Context-Rot Prevention
When a user pastes a mixed conversation (like the Nov 18–19 Jenny Discord DM) or syncs mail/voice:
1. **Immutable raw capture:** Store raw text/audio once in Octo Files (`source_id`, `channel`, `principal_id`, `visibility=private`). Never stuff raw history into future prompts.
2. **Shared entities, scoped claims:** People/orgs/events live once in the canonical graph; every extracted claim carries `(subject_entity_id, predicate, project_id, objective_id, claim_class, status, evidence_pointers)`.
3. **Deduplication:** Match `(subject_entity_id, predicate, project_id)` against active claims; merge new evidence pointers instead of creating duplicate rows.
4. **Superseding (`PROJECT.md` rule 7):** Contradicting newer facts (e.g., GIS Day slot moving from 1st to 3rd) mark the prior claim `superseded_by(new_id)`. Active prompt assembly reads `status = 'active'` only.
5. **Decay (TTL by claim class):**
   - `commitment` / `opportunity`: active until resolved/closed.
   - `durable_fact`: persistent with `last_verified_at` freshness badge.
   - `personal_rapport`: loaded only on person-prep or casual catch-ups.
   - `ephemeral_logistics`: auto-expires after 48 hours.
   - `banter`: `TTL = 0` (raw archive only, never enters working memory).
6. **Explicit identity review (`PROJECT.md` rule 6):** Never silently merge `MsSiLEPai`, `jliuhack@gmail.com`, and `msjennyliu2@gmail.com`; queue a 1-tap Identity Review card in `/approvals`.

### Q3. Agent-Guided Console UI (Frontend Tool Contract)
Instead of fragile DOM screen-scraping, expose typed frontend tools over **LiveKit Agents RPC** (for voice/console) and/or **AG-UI (CopilotKit)** paired with **Driver.js** spotlighting on stable `data-agent-target` attributes:
- `navigate(route: string)` — switch route without losing copilot context.
- `openDrawer(entityType, entityId)` — open Peek sheet for a person, project, or approval.
- `setAltitude(view, "glance" | "brief" | "deep")` — adjust density on demand.
- `applyFilter(view, filterSpec)` — filter tables/lists cleanly.
- `spotlight(targetId, message, stepIndex?)` — dim surrounding UI and highlight a button/claim.
- `stageDraft(actionType, payload)` — pre-fill a form or approval card and stop at the human Approval Gate.

### Q4. Zero-Screen Phone Agent (Riley) & Ambient Capture (Wispr Flow)
- **Phone / Voice (Riley via LiveKit):** Support 3 zero-screen flows that write to the exact same Octo inbox/timeline as web clicks:
  1. *Commute briefing & voice approvals* (read top 3 items; spoken approve/tweak/decline).
  2. *45-second post-meeting voice dump* (extract claims, update cadence, stage follow-up draft).
  3. *On-the-go graph lookup* ("who can intro me to X?").
- **Ambient capture (Wispr Flow / Notetaker):** System-level dictation and mobile/in-room notes ingest as `private` sources into the 6-stage pipeline with zero manual CRM form entry.

### Q5. Consent-Gated External Action Runners (Luma, LinkedIn, Scheduled Tasks)
- Bind every external action (Luma RSVP, LinkedIn post/comment/DM reply, email follow-up, scheduled recurring task) to the **acting principal's** own authenticated local browser session (proven in `#15` / `COLLECTION-EXECUTION.md`) and explicit approval.
- Strict compliance with `PROJECT.md` rule 11: no autonomous outreach, no platform evasion, and no admin triggering actions on a teammate's personal session. Every action card shows exact payload + target + Do/Don't consequence before execution.

### Q6. Approval Triage UX (Do/Don't, Decline Path, Keys vs. Buttons)
- **Keep:** Explicit **Do / Don't** preview and explicit **decline path** (`stop` vs `re-plan` vs `snooze`) on every approval card—critical for both web and voice decisions.
- **Keep (lightweight):** Keyboard triage (`j/k/a/d/e`) and optimistic updates with visible rollback on `409`/`502`, while keeping clear primary buttons for low-volume days (1–5 decisions/day).

### Q7. Competitive Borrowings: Keep vs. Defer
- **Keep for Slice 5/6:** Sunsama agenda Glance, Zapier Do/Don't + decline path, Linear keyboard triage, Cloze/People.ai per-stage cadence, Affinity strength-weighted intro paths (Person Deep), Perplexity follow-up chips + sources panel.
- **Keep behind Deep / Agent Tools (never default Glance):** Attio saved views + inline edit, Clay per-row enrichment columns (with source waterfall -> evidence chips).
- **Cautionary lesson (Relay.app shutdown):** Keep approvals embedded inside the work surface (Today, Copilot, Phone), never as a disconnected automation product.

### Q8. Autonomous Human-UX Verification Protocol
Automated E2E tests (`click #approve-btn -> 200`) do not prove a human understands the UI. Stack three verification layers:
1. **Layer 1 — Deterministic & Metamorphic Hold-Outs (Hard Gate):** `scripts/validate_tenancy.py` (`MR1–MR9`) and Patchright (`U1–U4`) verify tenancy, 409 idempotency, cascade integrity, and byte-identical payloads across altitudes.
2. **Layer 2 — Goal-Driven Synthetic Persona Simulations (Autonomous UX Gate):** Run Playwright/Patchright LLM/VLM personas (UXAgent / AMUSER / PerceptUI pattern) using only the **pruned accessibility tree + screenshots** (no `data-testid` hints) on the real Jenny/GISMO/MTA tasks. Track:
   - *Zero-hint task completion rate*
   - *Backtrack / hesitation loop count*
   - *Time-to-first-action & Glance competing-target count*
3. **Layer 3 — Multimodal VLM Heuristic Audit + Human Calibration:** Score simulation traces + screenshots against Nielsen's 10 Usability Heuristics plus product rules (visible provenance, clear decline path, zero dead summaries, honest role-disabled reasons). Calibrate weekly with:
   - **1 week of owner real-usage logs** on the live console.
   - **2 teammate invite/join sessions** (observing first-time onboarding, join screen, and role clarity).

---

## 4. Owner Sign-Off Checklist (Issue #42)

Before moving `#39` (`RI-0014`), `#40` (`RI-0015`), and `#41` (`RI-0016`) from gated to accepted:
- [ ] Owner confirms 5 daily surfaces + 10 secondary/agent-navigated views.
- [ ] Owner confirms scoped-memory dedup/supersede/TTL rules and explicit identity-merge gating.
- [ ] Owner confirms consent-gated local action model (Luma/LinkedIn/email/schedules).
- [ ] Owner completes 1 week of usage notes + 2 teammate invite/join observations (or waives waiting period explicitly in `#42` comment).
- [ ] Owner posts sign-off comment on GitHub issue `#42`.
