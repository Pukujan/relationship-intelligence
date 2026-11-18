# Stack and ABA Contract

## Decision

Use ABA/Swarm to generate and iterate the application. Use ABA's standard React + Vite + TypeScript app shape and Octo as the durable backend.

Do not copy ABA's own database choices, create Supabase/Neon as a parallel product database, or use Nitro merely because ABA can generate it.

## Application stack

- React 19 + Vite + TypeScript.
- Tailwind + shadcn/ui.
- TanStack Query for server state.
- React Router for explicit routes.
- Zod for runtime contracts.
- Vitest + fast-check.
- Playwright.
- Biome.
- dependency-cruiser + knip.
- pnpm with committed lockfile and locked CI install.

Nitro is allowed only when a slice requires server-side session handling or credential brokering that cannot use Octo's existing surfaces. The first slice should prefer Octo workspace-scoped authentication and a thin typed adapter over a new application server.

## Existing code

- `seed/load.py` is a prototype Octo ledger writer, not the canonical production importer.
- `queries/social.cypher` and `queries/run.py` are query prototypes. The name-keyed and JSON-substring patterns must not become production identity resolution.
- `viz/` is exploratory and is not a product dependency.
- Existing Python import scripts may be reused behind a typed contract and validated with Ruff + mypy.

## ABA brief

ABA receives `PROJECT.md`, `docs/PLAN.md`, the accepted slice packet, and this file. It is instructed to:

1. keep the repository's architecture and naming;
2. implement only the accepted slice;
3. use Octo through the application adapter;
4. use Zod at external data boundaries;
5. add typecheck/test/lint scripts when scaffolding;
6. produce real accessible UI states, not screenshot-only mockups;
7. run tests and builds and repair failures;
8. leave a reviewable diff and a list of commands/results;
9. not add providers, credentials, generalized frameworks, or another database.

The integrator reviews generated code and reruns the full required gates. ABA's successful build is supporting evidence, not product acceptance.

## Authentication

Use Octo's supported authenticated session/API surfaces. Browser sessions never receive provider master credentials or Octo infrastructure credentials. Workspace-scoped authority is the default for automation.

Exact session bridging is decided in Slice 000 after testing the current Octo API. Do not invent a parallel login system.

## Deployment

The application deploys separately from Octo through the repository's selected deployment path. Octo remains the remote data platform. Production verification must exercise the real deployed frontend, Octo workspace, and required read/write permissions without using real private source data as test fixtures.
