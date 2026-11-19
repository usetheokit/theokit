---
'@theokit/agents': minor
---

Add `createGoalSignal`: an `update_goal` tool and a matching judge for `GoalRunner`, so the working agent can end a goal loop itself without the extra model call of the LLM judge. The signal has `status()` and `reset()`.
