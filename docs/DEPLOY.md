# Deploy Jarvis

Jarvis uses **SQLite via Node’s built-in `node:sqlite`** (Node **22+**, Railway image is **Node 24**). That means it needs a **persistent Node host** with a writable disk for the DB file — not a vanilla Vercel serverless deployment. (We intentionally do **not** use `better-sqlite3`; native addons were segfaulting on Railway.)

## Can Vercel do this?

**Not with the current stack.** Vanilla Vercel serverless has an ephemeral filesystem and no durable SQLite/Obsidian disk. Deploy on Railway / Fly / Render / a VPS instead. A later Postgres/Turso + remote vault migration would be required before Vercel is realistic.

## Recommended hosts

- **Railway** (path of least resistance — this repo includes `Dockerfile` + `railway.toml`)
- Fly.io / Render / a small VPS with **Node 22+** (24+ recommended)
- Mount a volume for `/data` (SQLite + optional Obsidian vault)
- Point each lane’s `vaultPath` at a mounted Obsidian folder if you want notes in prod

---

## Railway (step by step)

### 1. Create the service

1. [New project](https://railway.com/new) → Deploy from GitHub → select `jarvis`
2. Railway should pick up the root **`Dockerfile`** via `railway.toml`
3. If it still tries Nixpacks from the wrong folder, open **Settings**:
   - **Root Directory**: leave blank (`/`) when using the Dockerfile
   - **Builder**: Dockerfile
   - **Dockerfile path**: `Dockerfile`
4. Generate a public domain under **Settings → Networking**

> Immediate build failures (“no package.json”, empty detect) almost always mean Railway was pointed at the repo root *without* the Dockerfile, or Root Directory was wrong. This repo’s app lives in `apps/web`.

### 2. Volume (required)

1. Add a volume, mount it at **`/data`**
2. Set env:

```bash
JARVIS_DB_PATH=/data/jarvis.db
```

One replica only — SQLite does not like multiple writers.

### 3. Environment variables

| Var | Required | Notes |
|---|---|---|
| `OPENAI_API_KEY` | yes (for chat) | Uplink + drafts + briefing polish + Speak TTS |
| `OPENAI_MODEL` | no | Chat / polish / short drafts (default `gpt-4o-mini`) |
| `OPENAI_PLANNING_MODEL` | no | Research/ops planning notes, weekly reviews, recommendation polish (default `gpt-4o`; falls back to `OPENAI_MODEL`) |
| `CRON_SECRET` | **yes in production** | `openssl rand -hex 32` |
| `JARVIS_DB_PATH` | yes with volume | `/data/jarvis.db` |
| `BRIEFING_TZ` | recommended | IANA timezone, e.g. `America/Chicago` (not `CST`) |
| `CURSOR_API_KEY` | for code jobs | Cursor Dashboard → API Keys |
| `GITHUB_TOKEN` | recommended | private repos + PR CI watchdog |
| `GA4_SERVICE_ACCOUNT_JSON` | for GA4 / Search Console | Paste the **full** service-account JSON key (one line is fine). Same key is reused for GSC. Or set `GSC_SERVICE_ACCOUNT_JSON` instead. **Do not** rely on `GOOGLE_APPLICATION_CREDENTIALS=./lib/google/sa.json` on Railway — that file is gitignored and never copied into the Docker image. |
| `VERCEL_TOKEN` | for Vercel deploy status | Vercel → Settings → Tokens |
| `VERCEL_WEBHOOK_SECRET` | for Vercel deploy webhooks | Secret shown when creating the webhook |
| `RAILWAY_TOKEN` | for Railway deploy status | Railway → Account → Tokens |
| `DEPLOY_WEBHOOK_SECRET` | for Railway webhook URL | Falls back to `CRON_SECRET`; append `?secret=` on the Railway webhook URL |
| Gmail OAuth vars | optional | see `apps/web/.env.example` |

Enabling Search Console in GCP and adding the SA email on each property is **not** enough by itself — Railway still needs the private key JSON in one of those env vars.
Also set if you use Gmail after deploy:

```bash
GMAIL_OAUTH_REDIRECT_URI=https://YOUR_RAILWAY_DOMAIN/api/gmail/oauth/callback
```

### 4. Cron (required for always-on)

**Do not** put Railway “Cron Schedule” on the Jarvis web service — that turns it into a short-lived job. Keep Jarvis always-on, and ping tick from outside.

#### Option A — GitHub Actions (recommended)

This repo includes [`.github/workflows/jarvis-cron.yml`](../.github/workflows/jarvis-cron.yml).

1. GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**
2. Add:
   - `JARVIS_URL` — your public Railway URL, e.g. `https://jarvis-production-xxxx.up.railway.app` (no trailing slash)
   - `CRON_SECRET` — **same value** as Railway’s `CRON_SECRET`
3. Open **Actions → Jarvis cron tick → Run workflow** once to verify
4. The schedule runs every **10 minutes (UTC)** automatically

Note: GitHub scheduled workflows can drift/delay; for tighter timing use cron-job.org instead.

#### Option B — any external curl

Every 5–15 minutes:

```bash
curl -fsS -X POST \
  -H "Authorization: Bearer $CRON_SECRET" \
  "https://YOUR_RAILWAY_DOMAIN/api/cron/tick"
```

### 5. Obsidian knowledgebase

1. Sync your vault onto the volume, e.g. `/data/vault`
2. In the dashboard, set each lane’s **Obsidian vault path** to `/data/vault`
3. Ask the uplink to search a known note

### 6. Smoke test

```bash
curl -fsS -H "Authorization: Bearer $CRON_SECRET" \
  "https://YOUR_RAILWAY_DOMAIN/api/cron/tick"
```

Expect JSON with `jobs`, `email`, `dailyContent`, `briefings`, `weeklyReviews`, `watchdog`, `deployHealth`.

### Alternate: Nixpacks with Root Directory

If you prefer not to use Docker:

1. **Root Directory** = `/apps/web`
2. Config file path (Railway UI) = `/apps/web/nixpacks.toml` if needed
3. Still attach `/data` and set `JARVIS_DB_PATH`

---

## Generic build & start (VPS / local prod)

```bash
cd apps/web
npm ci
npm run build
npm run start
```

Serve behind HTTPS. Keep one long-lived Node process.

## Environment (full list)

Copy `apps/web/.env.example` → production env. Minimum useful set:

| Var | Purpose |
|---|---|
| `OPENAI_API_KEY` | Chat + drafted notes + briefing polish + Speak (OpenAI TTS) |
| `OPENAI_MODEL` | Chat / polish / short drafts (default `gpt-4o-mini`) |
| `OPENAI_PLANNING_MODEL` | Research/ops planning notes, weekly reviews, recommendation polish (default `gpt-4o`) |
| `OPENAI_TTS_MODEL` | Optional Speak model (default `tts-1`) |
| `OPENAI_TTS_VOICE` | Optional Speak voice (default `onyx`) |
| `CURSOR_API_KEY` | Code jobs → Cloud Agents |
| `CRON_SECRET` | Protects `/api/cron/*` (required in production) |
| `BRIEFING_TZ` | Operator timezone for morning/evening windows |
| `BRIEFING_MORNING_HOUR` | Local hour for morning briefing (default `7`) |
| `BRIEFING_EVENING_HOUR` | Local hour for evening briefing (default `18`) |
| `WEEKLY_REVIEW_WEEKDAY` | Local weekday for weekly review (`0`=Sun … `6`=Sat, or `monday`; default `1`) |
| `WEEKLY_REVIEW_HOUR` | Local hour for weekly review (default `9`) |
| `GITHUB_TOKEN` | Private repos + PR CI watchdog |
| Gmail / GA4 vars | Optional — see `.env.example` |

## Cron details

What `/api/cron/tick` does each run:

1. Advance queued/running jobs (`processQueuedJobs`)
2. Ingest Gmail (if configured)
3. Queue daily content drafts (idempotent per day)
4. Generate morning/evening briefing when the local hour matches
5. Generate weekly review + memory compaction when weekday/hour matches
6. Watch open PR CI on lanes with GitHub repos (notify once on failure)
7. Probe production URL / Vercel / Railway status on configured lanes (notify on down/degraded)

### Deploy webhooks (near-real-time)

1. Set `DEPLOY_WEBHOOK_SECRET` (or reuse `CRON_SECRET`) and `VERCEL_WEBHOOK_SECRET` on Jarvis
2. **Vercel** → Team/Account Settings → Webhooks → endpoint `https://YOUR_JARVIS/api/webhooks/vercel` (events: deployment created/succeeded/error/canceled)
3. **Railway** → each project Settings → Webhooks → `https://YOUR_JARVIS/api/webhooks/railway?secret=YOUR_SECRET`
4. Lane `deployProjectId` must match the Vercel project id/name or Railway project/service id
5. Hub **Live environments** strip reads cached status and polls `/api/deploy/overview` every 60s

### Host crontab example

```cron
*/10 * * * * curl -fsS -X POST -H "Authorization: Bearer YOUR_SECRET" https://YOUR_HOST/api/cron/tick >> /var/log/jarvis-cron.log 2>&1
```

### Individual routes (also protected)

| Route | Use |
|---|---|
| `GET/POST /api/cron/tick` | Everything above |
| `GET/POST /api/cron/briefing` | Force/latest briefing (`?kind=morning&force=1`, `?latest=1`) |
| `GET/POST /api/cron/weekly-review` | Force/latest weekly review (`?force=1`, `?latest=1`, optional `?projectId=`) |
| `GET/POST /api/cron/daily-content` | Daily Skool/content drafts only |
| `GET/POST /api/cron/email-ingest` | Gmail ingest only |

Query helpers on tick: `?forceBriefing=1`, `?forceWeekly=1`, `?forceContent=1`, `?skipWatchdog=1`, `?secret=` (same as Bearer).

## Chat tools

- `get_briefing` / `run_briefing` — read or generate digests
- `get_weekly_review` / `run_weekly_review` — weekly digest + `Memory/<slug>/Current.md` compaction
- `check_pr_ci` — run the PR CI watchdog on demand
- `get_lane_deploy` / `check_deploy_health` — production URL + Vercel/Railway status
- `ingest_emails` / `draft_daily_post` — same as before
