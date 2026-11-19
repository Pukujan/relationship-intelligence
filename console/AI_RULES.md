# Tech Stack

- You are building a React application.
- Use TypeScript.
- Use React Router. KEEP the routes in src/App.tsx
- Always put source code in the src folder.
- Put pages into src/pages/
- Put components into src/components/
- The main page (default page) is src/pages/Index.tsx
- UPDATE the main page to include the new components. OTHERWISE, the user can NOT see any components!
- ALWAYS try to use the shadcn/ui library.
- Tailwind CSS: always use Tailwind CSS for styling components. Utilize Tailwind classes extensively for layout, spacing, colors, and other design aspects.

Available packages and libraries:

- The lucide-react package is installed for icons.
- You ALREADY have ALL the shadcn/ui components and their dependencies installed. So you don't need to install them again.
- You have ALL the necessary Radix UI components installed.
- Use prebuilt components from the shadcn/ui library after importing them. Note that these files shouldn't be edited, so make new components if you need to change them.

# Data & design invariants

- Every screen reads and writes through `src/data/source.ts` (`MissionControlSource`) via `useData()` in `src/data/store.tsx`. Never import `src/data/seed.ts` outside the source module.
- Operational data is local seed for now; the interface JSDoc maps each method to Octo (epistemic API, workspace SQL, RAG + graph). Every claim keeps a source label — unverified facts stay flagged.
- Dark-only theme: use the tokens in `src/globals.css` (`bg-background`, `text-muted-foreground`, `text-primary` for the coral accent, `text-run` for running/positive, `text-warn` for needs-you). Don't hardcode one-off colors.
- The copilot, voice surface, and phone calls share one orchestrator (`src/components/copilot/OrchestratorProvider.tsx` + `src/lib/orchestrator.ts`). Route new intents through `planRequest` so all three channels stay unified.

# Information architecture

- Entry is `/signin` (Octo Google auth or guest demo); everything else sits behind `RequireSession` in `src/App.tsx`. Sign-out returns to `/signin`.
- The sidebar is grouped, in this order: TODAY, INBOX, WORK, RELATIONSHIPS, CALENDAR, AGENTS, KNOWLEDGE, INTEGRATIONS. The container switcher (Organization ▾ · Workspace ▾ · Project ▾) sits above it and is a tenancy/context boundary, never a nav tab. Do not reintroduce a flat agent-centric nav.
- Work hierarchy: Project → Objective → Mission → (Plan + Tasks). Objectives belong to a project, missions to an objective, plans/tasks to a mission. `useData().activeProjectId` ("all" or a project id) scopes the work views, Today's missions, and the calendar.
- Projects and missions **reference** people/companies/events by id from `src/data/types.ts`; they never own or duplicate them. People are organised by tags and saved smart lists (`peopleForSmartList`), never folders.
- Status vocabularies live in `src/data/derive.ts` (`projectStatusMeta`, `objectiveStatusMeta`, `missionStatusMeta`, `connectorStatusMeta`, `mcpStatusMeta`) — reuse them instead of new one-off colour maps.
- Connectors show status and owning principal only. Never render credentials, tokens, or secret values in any view.
