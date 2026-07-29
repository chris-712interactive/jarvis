# AGENTS.md

## Cursor Cloud specific instructions

Jarvis is a monorepo. The only implemented service is the web app at **`apps/web`** — a Next.js 16 (App Router, Turbopack) + React 19 command center with Phase 2 chat. All commands below run from `apps/web`. Standard run/build/lint/seed commands are documented in the root `README.md` and `apps/web/package.json` (`dev`, `build`, `start`, `lint`, `db:seed`); prefer those.

### Non-obvious notes

- **Storage is local SQLite via Drizzle**, not Postgres (despite the architecture doc's later-phase suggestion). `apps/web/lib/db/index.ts` auto-creates the DB file and tables on first access, and the schema is seeded automatically on the first request — so `npm run dev` alone is enough; `npm run db:seed` is optional. DB lives at `apps/web/data/jarvis.db` (git-ignored, WAL mode). Delete the `apps/web/data/` directory to reset to a fresh seed. Override the location with `JARVIS_DB_PATH` (see `apps/web/.env.example`); no env vars are required to run the hub UI alone.
- **Phase 2 chat** needs `OPENAI_API_KEY` in `apps/web/.env.local` (optional `OPENAI_MODEL`, default `gpt-4.1-mini`). Without it, `/api/chat` returns 503 and the uplink panel shows setup instructions. Streaming + tools live in `app/api/chat/route.ts` with read-only tools in `lib/chat/tools.ts`.
- **Push-to-talk** uses the browser Web Speech API (Chrome/Edge). Tap **Mic**, speak, tap **Stop** to send. Always-listening wake word is not implemented yet. Typing still works everywhere.
- **Obsidian / markdown vaults** are optional per-project memory. Set `vaultPath` on a project (absolute, `~/...`, or relative to `apps/web`). Read-only helpers live in `apps/web/lib/vault/notes.ts` and expose `GET /api/projects/[id]/notes` (list or `?q=` search) and `GET /api/projects/[id]/notes/read?path=...`. Paths are sandboxed to the vault root; `.obsidian` is skipped. Sample vault: `apps/web/fixtures/sample-vault`.
- `better-sqlite3` is a **native module** compiled during `npm install`. If the dashboard 500s with a "was compiled against a different Node.js version" (NODE_MODULE_VERSION) error after a Node upgrade, run `npm rebuild better-sqlite3` (or reinstall) in `apps/web`.
- Dev server runs on `http://localhost:3000`. REST APIs live under `/api/projects`, `/api/projects/[id]`, `/api/projects/[id]/notes`, `/api/chat`, `/api/conversations`, and `/api/jobs`.
- There is no automated test suite yet.
