# Jarvis

An AI command center for everything you’re working on — with a conversational operator you can talk to like Jarvis, and background agents that keep moving while you do something else.

## Idea

Jarvis is three things sharing one brain:

1. **Dashboard** — all projects, what needs you, what’s in flight
2. **Conversation** — text/voice interface that routes intent to the right project
3. **Async workforce** — durable jobs (coding agents, research, watchdogs) you don’t have to babysit

## Docs

- [Architecture & build guide](docs/ARCHITECTURE.md) — how to put this together end-to-end
- [Product contract](docs/PRODUCT.md) — behavior, trust, interrupt policy

## Suggested build order

1. Project Hub + dashboard (`Needs you` / `In flight` / `Projects`)
2. Project-grounded chat (read-only tools)
3. Async jobs + notifications (“while I’m busy”)
4. Voice push-to-talk
5. Dispatch real coding agents (e.g. Cursor Cloud Agents) as workers

## Status

Greenfield. Architecture captured; implementation not started.
