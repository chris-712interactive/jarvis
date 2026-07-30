# Command hub

Local sample vault for the dashboard Obsidian integration.

## Current goal

Ship a command center for every active project with async agents.

## Architecture decisions (resolved)

- **Storage:** keep **SQLite** for the local hub for now (simple, zero-ops). Revisit Postgres when multi-device sync or multi-user auth lands.
- **Auth:** defer until after chat + tools are useful. Single-operator local mode is fine; add Auth.js/Clerk when the hub needs accounts.

## Open questions

_None blocking Phase 1–3._
