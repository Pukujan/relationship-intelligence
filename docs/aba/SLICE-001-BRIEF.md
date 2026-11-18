# ABA Build Brief — Slice 001

Implement only after the Slice 001 issue is accepted.

Read: `PROJECT.md`, `docs/PLAN.md`, `docs/STACK.md`, `docs/VALIDATION.md`, and the accepted issue packet.

## User job

Import a small, valid people/event CSV export, review ambiguous identities without merging them, and open a person profile whose displayed facts link to source evidence.

## Scope

- Authenticated workspace selection/connection.
- CSV upload and mapping preview.
- Immutable raw-file storage through Octo Files.
- Typed source-record creation with source row identity and content hash.
- Canonical person/organization/event creation using Octo entity IDs.
- Evidence-backed employment and event-registration claims.
- Candidate duplicate review; no automatic merge on name/company.
- People directory and person profile with current facts and evidence.
- Repeat import with no duplicate canonical state.

## Do not add

- Autonomous web scraping or LinkedIn session automation.
- Public social feed, messaging, outreach, or payments.
- Sponsorship scoring, graph visualization, or analytics dashboards.
- A second canonical database.
- A generalized plugin/rules framework.
- Direct LLM writes to canonical facts.

## Implementation requirements

Use React + Vite + TypeScript, Tailwind/shadcn, TanStack Query, and Zod. Keep Octo access behind one typed adapter. Add strict typecheck, Biome, Vitest/fast-check, dependency-cruiser, knip, and Playwright scripts. Use accessible loading, empty, error, review, and success states.

Return changed files, test/build commands and results, unresolved assumptions, and a concise walkthrough. Do not declare the user job complete without the real import-to-profile Playwright path passing.
