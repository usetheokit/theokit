---
'@theokit/agents': minor
---

Add `hooksForChild` to `@theokit/agents/hooks`: turns a parent's `HookHandlers` into an SDK `Plugin` for a child agent, so the parent's `pre_tool_call` veto reaches the child with the child's real `agentId` and `runId`. `post_tool_call` and `transform_tool_result` are opt-in through `forward`.
