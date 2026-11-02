---
"theokit": patch
---

`theokit build` no longer deletes the agent context in `.theokit/`. It emptied the whole directory before writing its output there, so the first build of a fresh scaffold removed `THEO.md`, `rules/` and `personalities/`. The build now keeps `THEO.md`, `rules/`, `personalities/`, `skills/`, `agents/`, `commands/` and `hooks.json`, plus local agent state such as `memory/`, `THEO.local.md` and `mcp-tokens.json`. (#1079)
