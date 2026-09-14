---
"@theokit/agents": minor
---

The agent can declare the work it is judged on.

The runtime already modelled tasks and already emitted their lifecycle — `Task.submit` is published,
`task_started` / `task_updated` / `task_completed` reach a consumer, and B-018 shipped moderation for
`task_progress.text`. What was missing was the way in: measured, `packages/agents/src` emitted
`task_started` in **0** files, so the channel was reachable by the embedder and by nothing the model
could call. A UI could draw a task list the agent had no way to populate.

```ts
import { createTaskDeclareTool, createTaskCompleteTool } from '@theokit/agents/tools'
```

**A declaration is a DEFERRED task, and that is the design rather than an accident.** `Task.submit`
takes a work FUNCTION — it was built to run work, and a declaration has none: the work is the agent,
across turns. So the submitted work returns a promise that stays pending until `task_complete`
resolves it.

The naive alternative is worth naming because it looks correct: work that returns immediately emits
`task_started` and `task_completed` in the same tick, so every declaration is born finished and
"declared and still open" can never be told from "never declared".

**Completing an id that was never declared RAISES**, naming the id. A silent no-op would leave the
agent believing the unit closed while the list still shows it open — the one outcome nobody can
detect afterwards.

**A registry that refuses is reported to the model**, not thrown: a registry being down is not a
reason for the run to end.
