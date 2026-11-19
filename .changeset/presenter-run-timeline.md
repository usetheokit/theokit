---
'@theokit/presenter': minor
---

Add `fromRunTimelineEvent`, `createRunTimelineState` and `flushRunTimeline`: the door from the SDK's `run.events()` timeline into `AgentOutputEvent`. Streamed text and reasoning are not repeated, tool lifecycle points are deduplicated by id, and a tool result is held until the other report can mark it failed.
