---
'@theokit/agents': minor
---

Added `hooksForChild` to `@theokit/agents/hooks`: it turns a parent's `HookHandlers` into an SDK `Plugin` so the parent's `pre_tool_call` veto reaches child agents with their real `agentId` and `runId`.
