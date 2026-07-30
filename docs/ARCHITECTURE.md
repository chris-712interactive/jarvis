# Jarvis — Architecture & Build Guide

How to put together an AI dashboard that unifies your projects and lets you talk to it like Jarvis — including while you're busy with something else.

---

## 1. What you're actually building

Jarvis is not a chat UI with a pretty sidebar. It is three products sharing one brain:

| Layer | Job |
|---|---|
| **Command center** | One screen that shows *all* active projects, their status, blockers, next actions, and agent activity |
| **Conversational operator** | A voice/text interface that understands context across projects and can *do* things, not just answer |
| **Async workforce** | Background agents that keep working after you look away — PRs, research, drafts, monitoring |

The product promise in one sentence:

> Speak a goal once; Jarvis routes it to the right project, runs work in the background, and reports back when something needs you.

---

## 2. The core loop (design this first)

Everything else hangs off this loop:

```
You speak / type intent
        ↓
Intent router (which project? what kind of work?)
        ↓
Plan (tools + steps + permissions)
        ↓
Execute (sync for Q&A, async for real work)
        ↓
State update (project memory + dashboard)
        ↓
Notify (chat, push, email, Slack — only when useful)
```

If a feature doesn't feed this loop, defer it.

---

## 3. System architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        CLIENTS                              │
│  Web dashboard │ Mobile/PWA │ Voice (mic / wake word)        │
│  Slack/Telegram bot │ IDE bridge (Cursor / CLI)              │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│                     API GATEWAY                             │
│  Auth · sessions · streaming chat · webhooks                │
└────────────────────────────┬────────────────────────────────┘
                             │
          ┌──────────────────┼──────────────────┐
          ▼                  ▼                  ▼
   ┌────────────┐    ┌──────────────┐   ┌──────────────┐
   │  Orchestrator│    │ Project Hub  │   │ Job Runner   │
   │  (LLM brain) │    │ (registry +  │   │ (queues +    │
   │              │    │  memory)     │   │  agents)     │
   └──────┬───────┘    └──────┬───────┘   └──────┬───────┘
          │                   │                  │
          └─────────┬─────────┴────────┬─────────┘
                    ▼                  ▼
            ┌──────────────┐   ┌──────────────┐
            │ Tool adapters│   │ Event bus /  │
            │ GitHub,Linear│   │ notifications│
            │ Drive,Cal,…  │   │              │
            └──────────────┘   └──────────────┘
```

### Responsibilities

**Orchestrator** — the Jarvis personality + planner. Turns natural language into tool calls and jobs. Holds short-term conversation state. Never owns long-term project truth alone.

**Project Hub** — source of truth for projects: repos, docs, goals, status, open threads, last agent runs. This is what makes the dashboard real.

**Job Runner** — durable async execution. Cloud agents, scripts, webhooks, long research. Survives browser close and phone lock.

**Tool adapters** — thin, audited connectors. Prefer read-first; write with confirmations until trust is earned.

---

## 4. Product surfaces

### 4.1 Dashboard (command center)

One composition, not a wall of widgets. Recommended first viewport:

- Brand / identity: **Jarvis**
- One primary question: *What needs me?*
- Active work stream (agents currently running)
- Project switcher that changes *context*, not just filters

Below the fold (separate sections, one job each):

1. **Needs you** — blockers, review requests, failed jobs
2. **In flight** — background agents / jobs
3. **Projects** — cards only if interactive (open, assign, pause); otherwise a clean list
4. **Recent outcomes** — what finished since last visit

Avoid: stat strips, emoji clutter, purple glow themes, dashboard-as-wallpaper.

### 4.2 Conversational interface (the Jarvis feel)

Modes to support from day one:

| Mode | When | Behavior |
|---|---|---|
| **Talk** | Hands busy | Voice in → short spoken + text summary out |
| **Dictate work** | Driving / walking | Capture intent → queue job → confirm later |
| **Deep chat** | At desk | Streaming text, tool traces, approve writes |
| **Ambient** | Background | Jarvis only interrupts on thresholds you set |

Personality principles:

- Concise by default; expandable on request
- Always ground answers in a named project when possible
- Prefer “I started X; I’ll ping you when Y” over long essay replies
- Ask one clarifying question, not five

### 4.3 “Work on things while I’m doing something else”

This is the heart of the product. Implement it as **explicit async jobs**, not as a long chat that pretends to multitask.

Patterns that work:

1. **Fire-and-forget agent** — “Refactor auth in Project A and open a PR.” → job + branch + PR link when done
2. **Watchdog** — “Watch CI on Project B; only tell me if it fails.” → webhook listener
3. **Parallel lanes** — you’re editing Project C while agents run on A and B; dashboard shows all lanes
4. **Interrupt budget** — urgency levels: silent / digest / nudge / interrupt
5. **Resume tokens** — every job has a deep link: open dashboard → that project → that run

Without durable jobs + notifications, “Jarvis while I’m busy” collapses into a chat tab you’ll forget.

---

## 5. Data model (minimum viable)

```
User
  └── Workspace
        ├── Project
        │     ├── sources[]      # repos, folders, Notion DBs, Drive paths
        │     ├── goals[]        # current outcomes, not vibes
        │     ├── memory         # embeddings + structured facts
        │     ├── integrations   # tokens / webhook ids
        │     └── status         # active | paused | archived
        ├── Conversation
        │     ├── messages[]
        │     └── active_project_id?
        ├── Job
        │     ├── project_id
        │     ├── kind           # code | research | ops | message
        │     ├── status         # queued | running | needs_you | done | failed
        │     ├── artifact_urls[]
        │     └── interrupt_level
        └── NotificationPolicy
```

**Project memory** should be dual:

- **Structured**: goals, owners, deadlines, repo URLs, conventions
- **Semantic**: embeddings over docs/PRs/notes for retrieval

Never rely on the LLM’s chat history as project memory.

---

## 6. Orchestrator design

### 6.1 Intent routing

Every user utterance gets classified roughly as:

1. **Query** — answer from memory/tools, no side effects
2. **Action** — do something now (create issue, send message)
3. **Mission** — multi-step async work (spawn job)
4. **Meta** — dashboard / preferences / “what’s running?”

Route *before* heavy generation. Cheap classifier or constrained tool choice works.

### 6.2 Tool policy

| Risk | Examples | Policy |
|---|---|---|
| Read | list PRs, search docs | Always allowed |
| Soft write | draft PR description, create draft issue | Auto with audit log |
| Hard write | merge, deploy, send email, spend money | Explicit confirm |
| Destructive | delete repo, force-push | Confirm + typed project name |

### 6.3 Context packing

For each turn, assemble:

1. Active project card (goals, status, open jobs)
2. Top-k retrieved memory
3. Recent job outcomes
4. User interrupt preferences
5. Only the tools relevant to that project

Do not dump every project into every prompt.

---

## 7. Recommended stack (pragmatic)

Build for a solo operator first; avoid enterprise ceremony.

| Concern | Suggestion | Why |
|---|---|---|
| App | Next.js (App Router) + TypeScript | Fast dashboard + API routes + streaming |
| Auth | Clerk or Auth.js | Low friction, multi-device |
| DB | Postgres (Neon/Supabase) | Jobs, projects, structured memory |
| Queue | Inngest, Trigger.dev, or BullMQ | Durable async without babysitting |
| Vectors | pgvector or a hosted vector DB | Project memory retrieval |
| LLM | Primary strong model + cheap router model | Cost/latency tradeoff |
| Voice STT | Whisper API / Deepgram | Reliable dictation |
| Voice TTS | Optional later (ElevenLabs / OpenAI) | Nice-to-have after text works |
| Code agents | Cursor Cloud Agents / CLI / custom sandbox | Real coding work off your laptop |
| Source control | GitHub App | Project + PR + webhook spine |
| Comms | Slack or Telegram bot | “While I’m busy” channel |
| Hosting | Vercel + worker (Fly/Railway) | Web + long jobs |

**Buy vs build rule:** buy voice, auth, queue, hosting. Build orchestration, project hub, and the interaction model — that’s the product.

---

## 8. Integration map (what “all my projects” means)

Connect in this order:

1. **GitHub** — repos, PRs, CI, issues (highest leverage)
2. **Local / monorepo inventory** — manual project registry if repos aren’t everything you work on
3. **Issue tracker** (Linear/Jira/GitHub Issues) — goals & blockers
4. **Calendar** — “what am I supposed to be doing”
5. **Notes** (Notion/Obsidian/Drive) — memory corpus
6. **Chat** (Slack/Telegram) — ambient channel
7. **Billing / analytics** — GA4 (and later product metrics) written into the Project Hub per lane
8. **Comms / community** — draft→approve for Skool/etc.; auto-publish only when a trusted channel exists

Each integration should write into the Project Hub, not only into chat context.

---

## 9. Build phases

### Phase 0 — Decide the operator contract (1 sitting)

Write answers to:

- What may Jarvis do without asking?
- How do I want to be interrupted?
- What is a “project” for me (repo? client? life area?)
- Success metric for week 1 (e.g. “I can ask status across 5 projects and spawn one background coding job”)

### Phase 1 — Project Hub + dashboard skeleton ✅

- ~~Auth~~ → deferred (local single-operator; add when multi-user needed)
- CRUD projects (name, repo URL, goals, status, vault path)
- Manual status notes / Needs you flags + Approve/Resolve
- “Needs you / In flight / Projects” layout
- No LLM required for the hub shell — still useful

### Phase 2 — Chat with project grounding ✅

- Streaming chat
- Attach conversation to a project (or auto-route by named lane)
- Obsidian vault retrieval (list / search / read / write)
- GitHub read adapters: repo summary + open PRs
- Read-only status tools + async job tools

### Phase 3 — Async jobs (“while I’m busy”) ✅

- Job table + local runner (`queued → running → done|needs_you`)
- `start_job` / `get_job` / `resolve_job` from chat
- Dashboard poller + `/api/jobs/process`
- In-app notifications (header Alerts); email/Telegram later
- Resume via Needs you / Recent + job ids

### Phase 4 — Voice & ambient ✅ (browser)

- Push-to-talk in web
- Ambient wake word (Web Speech)
- Spoken replies (Speak on) + short confirmations

### Phase 5 — Real workforce ✅ (Cloud Agents)

- Cursor Cloud Agents as job workers for `kind: code` (`CURSOR_API_KEY`)
- PR creation via agent `autoCreatePR` + hub surfaces PR/agent URL on the job
- Watchdogs for CI / deploys (next)
- Multi-project parallel lanes with interrupt budgets (partial — parallel code jobs supported)

### Phase 6 — Content + analytics ✅ (draft + GA4 reads)

- Daily Skool/channel drafts per lane (`dailyContent`, `contentChannel`, `contentBrief`)
- Approve-before-post via **Needs you** (no Skool auto-publish yet)
- GA4 read adapter (`gaPropertyId` + service account) for “what’s working” per lane
- Cron endpoint `/api/cron/daily-content`

### Phase 6b — Gmail workforce ✅ (approve-gated reply)

- Allowlisted senders per lane (`emailSenders`)
- Ingest cron `/api/cron/email-ingest` → code job → Cloud Agent PR
- Operator **Approve & reply** sends completion email on the same thread

### Phase 7 — Personality & polish

- Named voice, concise style pack
- Proactive digests (“morning briefing”)
- Memory compaction / weekly project reviews
- Mobile-first PWA
- Skool/community auto-publish if/when a safe API exists
- Watchdogs for CI / deploys

Ship each phase usable alone. Do not wait for wake-word Jarvis before the hub is real.

---

## 10. How Cursor fits (use it; don’t rebuild it)

You already have pieces of this stack in Cursor:

| Need | Cursor capability |
|---|---|
| Background coding while you do something else | Cloud Agents / Background Agents |
| Multi-repo / environment work | Cloud Environments |
| Scheduled / event-driven work | Automations |
| Talking to an agent about a repo | Agent chat + Cloud Agents web UI |

**Smart architecture:** Jarvis is the *control plane* and *conversation layer*. Cursor (and similar) are *execution backends* for code missions.

That means early Jarvis should:

1. Know your projects and goals
2. Decide when work is a coding mission
3. Dispatch to Cursor Cloud Agent / CLI / your own runner
4. Track the run, surface the PR, ask you only when needed

Rebuilding a full coding agent inside Jarvis is a trap. Orchestrate one.

---

## 11. Conversation UX patterns that feel like Jarvis

Concrete prompt/behavior contracts:

- **Acknowledge + act:** “On it — spinning up a job on *carline-dad* to draft the onboarding PR. I’ll ping when it’s ready for review.”
- **Name the project:** never leave context ambiguous
- **Offer the next useful move:** one suggestion, not a menu of ten
- **Show work without dumping logs:** link to job detail; keep chat human
- **Failure honesty:** “CI failed on auth tests; I paused before merge.”

System prompt should encode: brevity, project grounding, tool discipline, interrupt policy.

---

## 12. Security & trust (non-optional)

- Per-project secrets vault; never put tokens in prompts
- Tool allowlists per project
- Full audit log of tool calls and job outcomes
- Human-in-the-loop for hard writes
- Separate “personal” vs “client” workspaces if needed
- Assume chat transcripts are sensitive — encrypt at rest

Trust is the product. A clever agent that merges the wrong PR once is dead.

---

## 13. Evaluation — how you know it’s working

Track weekly:

- **Time-to-status:** how fast can you get a true picture across projects?
- **Jobs completed without you:** count of useful async completions
- **Interrupts accepted vs dismissed:** are notifications earned?
- **Context misses:** times Jarvis picked the wrong project
- **Hands-free successes:** voice → queued work → good artifact

If those don’t move, more UI chrome won’t help.

---

## 14. Suggested repo layout (when you start coding)

```
jarvis/
  apps/
    web/                 # Next.js dashboard + chat + voice
    worker/              # job runner / agent dispatcher
  packages/
    core/                # domain types, orchestrator interfaces
    db/                  # schema + migrations
    integrations/        # github, linear, slack, …
  docs/
    ARCHITECTURE.md      # this file
    PRODUCT.md           # operator contract & UX principles
  README.md
```

Monorepo recommended once you have web + worker; fine to start as a single Next.js app with Inngest functions in-process.

---

## 15. First week checklist

1. Define 5–10 real projects in a spreadsheet (name, repo, goal, “needs me” signal)
2. Stand up Next.js + Postgres + Auth
3. Build Project Hub CRUD + the three dashboard sections
4. Add streaming chat grounded on one project’s notes + GitHub read API
5. Add one async job type: “summarize this repo / open PRs overnight”
6. Wire Telegram or email notify-on-complete
7. Only then add voice push-to-talk

That sequence gets you a usable Jarvis spine without boiling the ocean.

---

## 16. Anti-patterns

- Starting with a wake word and personality before project state exists
- One giant agent prompt with every tool and every repo
- Treating chat history as the database
- Dashboard full of vanity metrics
- Auto-writing to production systems on day one
- Building your own coding agent instead of dispatching to Cursor/sandboxes
- Interrupting for every token streamed

---

## 17. Decision summary

| Question | Answer |
|---|---|
| What is Jarvis? | Control plane + conversation + async workforce over your projects |
| What’s the first artifact? | Project Hub + “Needs you / In flight” dashboard |
| How do you talk to it? | Text first, voice second; always project-grounded |
| How do you multitask? | Durable jobs + notifications + resume links |
| Where does coding happen? | Dispatched agents (Cursor Cloud Agents, etc.), tracked by Jarvis |
| What’s the hard part? | Memory, routing, trust — not the chat bubble |

When you’re ready to implement, start at Phase 1 and keep the orchestrator thin until the hub is trustworthy.
