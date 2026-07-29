# Jarvis

An AI command center for everything you’re working on — with a conversational operator you can talk to like Jarvis, and background agents that keep moving while you do something else.

## Docs

- [Architecture & build guide](docs/ARCHITECTURE.md)
- [Product contract](docs/PRODUCT.md)

## Phase 1–2 (implemented)

Project Hub + dashboard shell in `apps/web`:

- SQLite + Drizzle schema for `projects`, `jobs`, `conversations`, `messages`
- REST APIs under `/api/projects`, `/api/jobs`, `/api/chat`, `/api/conversations`
- Dashboard lanes: **Needs you** / **In flight** / **Projects** / Recent outcomes
- Create + edit projects
- **Obsidian vault path per project** + read-only notes browse/search API
- **Phase 2 chat uplink** grounded on a selected lane with read-only tools

### Chat (Phase 2)

1. Copy `apps/web/.env.example` → `apps/web/.env.local`
2. Set `OPENAI_API_KEY`
3. `npm run dev` and click **Open uplink** on the command center

Read-only tools available to the operator:
- dashboard / project / job status
- Obsidian list, search, and read for the active lane

### Obsidian vaults (local memory)

Each project can point at a local folder (an Obsidian vault or any markdown tree):

- Absolute path, `~/...`, or a path relative to `apps/web` (e.g. `fixtures/sample-vault`)
- Read-only: list / search / open `.md` notes
- APIs: `GET /api/projects/:id/notes`, `GET /api/projects/:id/notes/read?path=...`

Seed data wires **Command hub** to `fixtures/sample-vault` for a quick demo.

### Run locally

```bash
cd apps/web
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The database seeds with sample projects on first request.

### Useful scripts

```bash
npm run dev      # Next.js dev server
npm run build    # production build
npm run db:seed  # seed if empty
```

## Build order

1. ~~Project Hub + dashboard~~
2. ~~Project-grounded chat (read-only tools)~~
3. Async jobs + notifications
4. Voice push-to-talk
5. Dispatch coding agents as workers
