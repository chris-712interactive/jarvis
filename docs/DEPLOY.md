# Deploy Jarvis

Jarvis uses **SQLite + `better-sqlite3`** (a native Node module). That means it needs a **persistent Node host**, not a vanilla Vercel serverless deployment.

## Recommended hosts

- Railway / Fly.io / Render / a small VPS with Node 20+
- Mount a volume (or keep the process filesystem) for `apps/web/data/` (or set `JARVIS_DB_PATH` to the volume path)
- Point each lane’s `vaultPath` at a mounted Obsidian folder if you want notes in prod

Vanilla **Vercel serverless is a poor fit**: ephemeral filesystem, no durable SQLite, and native modules are awkward. If you want edge hosting later, move the DB to Postgres/Turso first.

## Environment

Copy `apps/web/.env.example` → production env. Minimum useful set:

| Var | Purpose |
|---|---|
| `OPENAI_API_KEY` | Chat + drafted notes + briefing polish |
| `CURSOR_API_KEY` | Code jobs → Cloud Agents |
| `CRON_SECRET` | Protects `/api/cron/*` (required in production) |
| `BRIEFING_TZ` | Operator timezone for morning/evening windows (e.g. `America/Chicago`) |
| `BRIEFING_MORNING_HOUR` | Local hour for morning briefing (default `7`) |
| `BRIEFING_EVENING_HOUR` | Local hour for evening briefing (default `18`) |
| `GITHUB_TOKEN` | Private repos + PR CI watchdog |
| Gmail / GA4 vars | Optional — see `.env.example` |

## Build & start

```bash
cd apps/web
npm ci
npm run build
npm run start
```

Serve behind HTTPS. Keep one long-lived Node process (or a single replica) so the SQLite file is not fought over by multiple writers.

## Cron (required for “always on”)

Hit the unified tick about every **5–15 minutes**:

```bash
curl -fsS -X POST \
  -H "Authorization: Bearer $CRON_SECRET" \
  "https://YOUR_HOST/api/cron/tick"
```

What `/api/cron/tick` does each run:

1. Advance queued/running jobs (`processQueuedJobs`)
2. Ingest Gmail (if configured)
3. Queue daily content drafts (idempotent per day)
4. Generate morning/evening briefing when the local hour matches
5. Watch open PR CI on lanes with GitHub repos (notify once on failure)

### Host crontab example

```cron
*/10 * * * * curl -fsS -X POST -H "Authorization: Bearer YOUR_SECRET" https://YOUR_HOST/api/cron/tick >> /var/log/jarvis-cron.log 2>&1
```

### Individual routes (also protected)

| Route | Use |
|---|---|
| `GET/POST /api/cron/tick` | Everything above |
| `GET/POST /api/cron/briefing` | Force/latest briefing (`?kind=morning&force=1`, `?latest=1`) |
| `GET/POST /api/cron/daily-content` | Daily Skool/content drafts only |
| `GET/POST /api/cron/email-ingest` | Gmail ingest only |

Query helpers on tick: `?forceBriefing=1`, `?forceContent=1`, `?skipWatchdog=1`, `?secret=` (same as Bearer).

## Chat tools

- `get_briefing` / `run_briefing` — read or generate digests
- `check_pr_ci` — run the PR CI watchdog on demand
- `ingest_emails` / `draft_daily_post` — same as before

## Health check

After deploy, open the dashboard, confirm seed lanes load, then:

```bash
curl -fsS -H "Authorization: Bearer $CRON_SECRET" \
  "https://YOUR_HOST/api/cron/tick"
```

You should get JSON with `jobs`, `email`, `dailyContent`, `briefings`, and `watchdog` keys.
