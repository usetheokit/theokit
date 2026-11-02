---
"create-theokit": patch
---

The scaffold's `.gitignore` versions the agent context in `.theokit/` (`THEO.md`, `rules/`, `personalities/`, `skills/`, `agents/`, `commands/`, `hooks.json`) and ignores everything else there: build output, agent memory, local overrides and MCP tokens. It ignored all of `.theokit/`, so the files the scaffold writes and the docs tell you to edit never reached git. (#1075)
