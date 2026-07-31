# Jarvis

An AI command center for everything you’re working on — with a conversational operator you can talk to like Jarvis, and background agents that keep moving while you do something else.

## Docs

- [Architecture & build guide](docs/ARCHITECTURE.md)
- [Product contract](docs/PRODUCT.md)
- [Deploy + cron (Railway / VPS)](docs/DEPLOY.md)

## Phase 1–5 + content/analytics (implemented)

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
- **Daily content drafts** — Skool/channel posts via `draft_daily_post` / cron; approve-before-post
- **GA4 lane analytics** — `get_lane_analytics` + `GET /api/projects/:id/analytics`
- **Search Console SEO** — `get_lane_search` + `GET /api/projects/:id/search-console`
- **Production deploy health** — URL probe + Vercel/Railway status, hub Live environments strip, deploy webhooks
- **Gmail → code agents** — allowlisted senders → Cloud Agent PR → Approve & reply
- **Scheduled tick + briefings** — `/api/cron/tick` advances jobs, email, daily content, morning/evening briefings, PR CI watchdog, and deploy health

### Chat + async jobs (Phase 2–3 + 5)

1. Copy `apps/web/.env.example` → `apps/web/.env.local`
2. Set `OPENAI_API_KEY`
3. For coding missions, also set `CURSOR_API_KEY` and put a GitHub repo URL on the lane
4. For analytics, set GA4 service-account credentials and a property id per lane
5. For email→code, set Gmail OAuth vars (see below)
6. `npm run dev` and click **Open uplink** on the command center
7. Type, use **Mic** (Chrome/Edge): tap mic → speak → tap again to send, or enable **Ambient on** and say “Jarvis …” for always-on wake-word capture
8. Ask the operator to start research/ops/draft/coding work — it should call `start_job` so the mission shows under **In flight**, then land in **Needs you** or **Recent** with an **Alerts** notification

Operator tools:
- dashboard / project / job status
- `start_job` / `get_job` / `resolve_job` / `draft_daily_post` / `ingest_emails`
- `get_briefing` / `run_briefing` / `check_pr_ci` / `get_lane_deploy` / `check_deploy_health`
- Obsidian list, search, read, write for the active lane
- GitHub `get_repo_summary` / `list_open_prs` for lanes with a repo URL
- GA4 `get_lane_analytics` for lanes with a property id
- Search Console `get_lane_search` for lanes with a GSC site URL

### Production deploy health (per lane)

1. On the lane, set **Production URL** (`https://…`)
2. Optionally set **Deploy host** (`url` | `vercel` | `railway` | `aws`) and **Deploy project / service id**
3. For Vercel: set `VERCEL_TOKEN` (+ optional `VERCEL_TEAM_ID`); id = Vercel project id or name
4. For Railway: set `RAILWAY_TOKEN`; id = Railway **service** id
5. Cron tick refreshes status and alerts on down/degraded; ask “is Clean Scheduler up?” for `get_lane_deploy`
6. Or `GET /api/projects/:id/deploy?refresh=1`
7. For near-real-time updates, add webhooks:
   - Vercel → `https://YOUR_JARVIS/api/webhooks/vercel` + `VERCEL_WEBHOOK_SECRET`
   - Railway → `https://YOUR_JARVIS/api/webhooks/railway?secret=DEPLOY_WEBHOOK_SECRET` (or `CRON_SECRET`)
8. Hub **Live environments** strip polls `/api/deploy/overview` every 60s

Local job runner (`POST /api/jobs/process`, also kicked on create and by the dashboard poller):
- `research` / `ops` → draft a markdown note into the lane vault under `Jarvis Jobs/` (OpenAI draft when keyed; otherwise a stub), then **done** + notification
- `message` → draft channel/Skool copy under `Content/<channel>/`, then **Needs you** (approve-before-post)
- `code` → launch a Cursor Cloud Agent against the lane’s GitHub repo (`CURSOR_API_KEY` required; repo must be connected in Cursor Integrations). Job stays **In flight** while the agent runs, then **done** (with PR link when available) or **needs_you** / **failed**. Email-originated code jobs finish as **Needs you** so you Approve before Jarvis replies.
- Missing vault path (non-code) or missing API key / repo URL (code) → **Needs you** with a configure message

### Gmail → code job → approve → reply

1. Google Cloud: create an OAuth **Web** client, enable **Gmail API**, add redirect `http://localhost:3000/api/gmail/oauth/callback`
2. Set `GMAIL_CLIENT_ID` + `GMAIL_CLIENT_SECRET` in `.env.local`
3. Visit `http://localhost:3000/api/gmail/oauth/start`, finish consent, copy `GMAIL_REFRESH_TOKEN` into `.env.local`
4. On each lane: set **Email senders** (allowlist) + GitHub **Repo URL**
5. Poll with `GET/POST /api/cron/tick` or `/api/cron/email-ingest` (Bearer `CRON_SECRET` in production) or ask the uplink to `ingest_emails`
6. Flow:
   - **code** intent → Cloud Agent / PR → **Needs you** → **Approve & reply**
   - **question** intent → draft reply in **Needs you** → **Approve & reply**
   - **ambiguous** → triage in **Needs you** (Resolve clears without emailing)

### Daily Skool / content drafts

On a lane (e.g. **Carline Dad Codes**):

1. Set **Content channel** (`skool`), turn **Daily content drafts** on, set a **Content brief**, and point at a vault
2. Ask the uplink to draft today’s post, or hit `GET/POST /api/cron/tick` / `daily-content` (set `CRON_SECRET` in production; send `Authorization: Bearer …`)
3. Draft appears under **In flight** → **Needs you** with a vault note under `Content/skool/`
4. Copy into Skool manually, then **Approve/Resolve**

### Scheduled tick + briefings

See [docs/DEPLOY.md](docs/DEPLOY.md). Short version:

1. Deploy on a **persistent Node host** (SQLite + `better-sqlite3` — not vanilla Vercel serverless)
2. Set `CRON_SECRET`, optional `BRIEFING_TZ` / morning+evening hours
3. Cron every 5–15 minutes: `POST /api/cron/tick` with `Authorization: Bearer …`
4. Morning/evening briefings land in **Alerts** (+ vault `Jarvis Jobs/briefings/` when the hub has a vault)
5. Ask the uplink for “morning briefing” (`get_briefing` / `run_briefing`) or “check PR CI” (`check_pr_ci`)

### Google Analytics (per lane)

1. Create a GCP service account, enable **Google Analytics Data API**, download the JSON key
2. Add the service account email as **Viewer** on each GA4 property
3. Set `GA4_SERVICE_ACCOUNT_JSON` (or `GOOGLE_APPLICATION_CREDENTIALS` / `GA4_SERVICE_ACCOUNT_PATH`) in `.env.local`
4. Put the numeric **GA4 property ID** on the lane
5. Ask “what’s working on Carline Dad Codes?” or call `GET /api/projects/:id/analytics?days=7`

### Google Search Console (per lane)

1. On the same GCP project, enable **Google Search Console API**
2. In Search Console → Users, add the service account email to each site/domain property
3. Reuse `GA4_SERVICE_ACCOUNT_JSON` (or set `GSC_SERVICE_ACCOUNT_JSON`)
4. On the lane, set **Search Console site** to `sc-domain:example.com` or `https://example.com/`
5. Ask “SEO deep dive for ForgeRep” / “top queries last 28 days” — uplink calls `get_lane_search`
6. Or `GET /api/projects/:id/search-console?days=28`

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
6. ~~Daily content drafts + GA4 lane analytics~~
7. ~~Daily content drafts + GA4 lane analytics~~
8. ~~Gmail → code agents → approve → reply~~
9. ~~Cron tick + morning/evening briefings + PR CI watchdog~~
10. PWA polish / Skool auto-publish (if/when a safe channel exists) / trust budgets
