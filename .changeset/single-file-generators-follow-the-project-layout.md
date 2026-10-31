---
"theokit": patch
---

`theokit generate` writes route, action, page, ws, controller, agent, toolbox, workflow, eval, sandbox and memory files under the directories `theo.config.ts` declares (`serverDir`, `appDir`, `agentsDir`). They were hardcoded to `server/`, `app/` and `agents/`, so in the `create-theokit` scaffold (`src/server`, `src/app`) the file landed where no scanner looks and the CLI reported success. `generate agent` now writes `<agentsDir>/<name>.ts`, the file served at `/api/agents/<name>` as its comment says, and the agent carries a placeholder `policy` that refuses every caller until you declare one; the old `server/agents/<name>.agent.ts` was never served. A `theo.config.ts` that cannot be loaded is refused by name. (#1031)
