# AGENTS.md

## Cursor Cloud specific instructions

Jarvis is currently a single **Next.js (App Router) + TypeScript** app at the repo root — the Phase 1 "Project Hub + dashboard" skeleton from `docs/ARCHITECTURE.md`. There is only one service to run.

### Service: web (Next.js dashboard)

- Dev server: `npm run dev` (serves on `http://localhost:3000`). Standard scripts live in `package.json` (`dev`, `build`, `start`, `lint`).
- Lint: `npm run lint`. Type-check: `npx tsc --noEmit`.

### Non-obvious notes

- **Data store is a local JSON file, not a database.** The Project Hub persists to `.data/hub.json` (git-ignored) via `lib/store.ts`. It is created and seeded on first read, so a fresh clone starts with one seed project/job. Delete `.data/hub.json` to reset the dashboard to the seed state. This is intentional for Phase 1; per the architecture docs, a later phase migrates to Postgres (`lib/types.ts` already mirrors the documented data model).
- Mutations use **Next.js server actions** (`app/actions.ts`) with `revalidatePath("/")`; the dashboard page uses `export const dynamic = "force-dynamic"` so it always reflects the current store. There is no separate API layer yet.
- No environment variables or external services are required to run the app in dev.
