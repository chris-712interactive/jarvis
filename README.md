# Jarvis

An AI command center for everything you’re working on — with a conversational operator you can talk to like Jarvis, and background agents that keep moving while you do something else.

## Docs

- [Architecture & build guide](docs/ARCHITECTURE.md)
- [Product contract](docs/PRODUCT.md)

## Phase 1–5 (implemented)

Project Hub + dashboard shell in `apps/web`:

- SQLite + Drizzle schema for `projects`, `jobs`, `conversations`, `messages`, `notifications`
- REST APIs under `/api/projects`, `/api/jobs`, `/api/chat`, `/api/conversations`, `/api/notifications`
- Dashboard lanes: **Needs you** / **In flight** / **Projects** / Recent outcomes
- Create + edit projects
- **Obsidian vault path per project** + notes browse/search/read/write API
- **Phase 2 chat uplink** grounded on a selected lane
- **GitHub read adapters** — repo summary + open PRs (`GITHUB_TOKEN` optional)
- **Phase 3 async jobs** from chat → In flight → Needs you / Recent + in-app notifications
- **Phase 5 coding workers** — `kind: code` jobs launch Cursor Cloud Agents (`CURSOR_API_KEY`)

### Chat + async jobs (Phase 2–3 + 5)

1. Copy `apps/web/.env.example` → `apps/web/.env.local`
2. Set `OPENAI_API_KEY`
3. For coding missions, also set `CURSOR_API_KEY` and put a GitHub repo URL on the lane
4. `npm run dev` and click **Open uplink** on the command center
5. Type, use **Mic** (Chrome/Edge): tap mic → speak → tap again to send, or enable **Ambient on** and say “Jarvis …” for always-on wake-word capture
6. Ask the operator to start research/ops/draft/coding work — it should call `start_job` so the mission shows under **In flight**, then land in **Needs you** or **Recent** with an **Alerts** notification

Operator tools:
- dashboard / project / job status
- `start_job` / `get_job` / `resolve_job` (async workforce)
- Obsidian list, search, read, write for the active lane
- GitHub `get_repo_summary` / `list_open_prs` for lanes with a repo URL

Local job runner (`POST /api/jobs/process`, also kicked on create and by the dashboard poller):
- `research` / `ops` / `message` → draft a markdown note into the lane vault under `Jarvis Jobs/` (OpenAI draft when keyed; otherwise a stub), then **done** + notification
- `code` → launch a Cursor Cloud Agent against the lane’s GitHub repo (`CURSOR_API_KEY` required; repo must be connected in Cursor Integrations). Job stays **In flight** while the agent runs, then **done** (with PR link when available) or **needs_you** / **failed**
- Missing vault path (non-code) or missing API key / repo URL (code) → **Needs you** with a configure message

Chat can also call `write_vault_note` for short immediate writes (`POST /api/projects/:id/notes/write`).

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
3. ~~Async jobs + notifications~~
4. ~~Voice push-to-talk / ambient wake word~~
5. ~~Dispatch coding agents as workers~~
6. Watchdogs / digests / PWA polish
