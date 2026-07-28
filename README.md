# Jarvis

An AI command center for everything you’re working on — with a conversational operator you can talk to like Jarvis, and background agents that keep moving while you do something else.

## Docs

- [Architecture & build guide](docs/ARCHITECTURE.md)
- [Product contract](docs/PRODUCT.md)

## Phase 1 (implemented)

Project Hub + dashboard shell in `apps/web`:

- SQLite + Drizzle schema for `projects` and `jobs`
- REST APIs under `/api/projects` and `/api/jobs`
- Dashboard lanes: **Needs you** / **In flight** / **Projects** / Recent outcomes
- Create + edit projects

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
2. Project-grounded chat (read-only tools)
3. Async jobs + notifications
4. Voice push-to-talk
5. Dispatch coding agents as workers
