# AGENTS.md

## Cursor Cloud specific instructions

Jarvis is a monorepo. The only implemented service (Phase 1) is the web app at **`apps/web`** — a Next.js 16 (App Router, Turbopack) + React 19 dashboard. All commands below run from `apps/web`. Standard run/build/lint/seed commands are documented in the root `README.md` and `apps/web/package.json` (`dev`, `build`, `start`, `lint`, `db:seed`); prefer those.

### Non-obvious notes

- **Storage is local SQLite via Drizzle**, not Postgres (despite the architecture doc's later-phase suggestion). `apps/web/lib/db/index.ts` auto-creates the DB file and tables on first access, and the schema is seeded automatically on the first request — so `npm run dev` alone is enough; `npm run db:seed` is optional. DB lives at `apps/web/data/jarvis.db` (git-ignored, WAL mode). Delete the `apps/web/data/` directory to reset to a fresh seed. Override the location with `JARVIS_DB_PATH` (see `apps/web/.env.example`); no env vars are required to run.
- `better-sqlite3` is a **native module** compiled during `npm install`. If the dashboard 500s with a "was compiled against a different Node.js version" (NODE_MODULE_VERSION) error after a Node upgrade, run `npm rebuild better-sqlite3` (or reinstall) in `apps/web`.
- Dev server runs on `http://localhost:3000`. REST APIs live under `/api/projects`, `/api/projects/[id]`, and `/api/jobs`; the dashboard reads through these.
- There is no automated test suite yet.
