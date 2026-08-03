# Jarvis — Product Contract

Working definition for how Jarvis should behave as an operator, not just a chatbot.

---

## Promise

Speak a goal once. Jarvis routes it to the right project, runs work in the background, and only pulls you in when a human decision is required.

---

## What a “project” is

A project is a named outcome stream with:

- A clear current goal
- One or more sources (repo, docs, tracker)
- A status (`active` | `paused` | `archived`)
- An interrupt policy

Examples: a client site, a SaaS product, a content brand, a personal ops area. Not every GitHub repo needs to be a project — only things you actively steer.

---

## Operator rules

1. **Ground every answer in a project** when possible. Ambiguity → one clarifying question.
2. **Prefer action over essay.** Acknowledge, start work, report the artifact.
3. **Async by default for real work.** If it takes more than a short tool call, it becomes a job.
4. **Earn interrupts.** Silent < digest < nudge < interrupt. Default to digest.
5. **Read freely, write carefully.** Hard writes require confirmation until explicitly trusted.
6. **Show lanes.** You should always be able to see what is running while you do something else.
7. **Resume anywhere.** Every job and conversation has a deep link back to context.

---

## Conversation modes

| Mode | Input | Output | Typical use |
|---|---|---|---|
| Desk | Text | Streaming text + links | Planning, review, deep work |
| Hands-busy | Voice | Short spoken + text log | Driving, chores, gym |
| Ambient | Events | Digests / rare nudges | CI, agents finishing |
| Briefing | Schedule | Morning/evening summary | Start/end of day |

---

## Interrupt policy (defaults)

| Event | Level |
|---|---|
| Job completed successfully | Digest |
| Job needs a decision (merge, spend, publish) | Nudge |
| Job failed | Nudge |
| Security / destructive confirmation | Interrupt |
| Informational research finished | Digest |
| CI green | Silent |
| CI red on watched project | Nudge |

---

## Trust ladder

Per-lane `trustLevel` on projects (default **operator**). Promote on the project form — never globally.

1. **Observer** — reads repos, summarizes, answers questions (mutating tools blocked)
2. **Drafter** — creates drafts (jobs, vault notes, email drafts) without publishing; Cloud Agents do not auto-open PRs and finish as Needs you; cannot send email replies
3. **Operator** — can open PRs, create issues, send approved messages (current default approve gate)
4. **Autopilot** — like operator; narrow auto-finish for safe non-email code successes (no Instagram/Skool auto-publish, no auto-merge)

Enforcement lives in `apps/web/lib/trust/policy.ts` and is applied in chat tools, the job runner, email ingest, daily content, and Approve & reply.

Promote per project, never globally on day one.

---

## Success metrics

- Time to truthful multi-project status
- Useful jobs finished without babysitting
- Interrupt accept rate
- Wrong-project routing rate (should fall)
- Voice → queued work → good artifact conversions

---

## Non-goals (for now)

- Fully autonomous company-running AGI
- Replacing Cursor/IDE for hands-on coding sessions
- Wake-word hardware product
- Social features / multi-user collaboration (solo operator first)
