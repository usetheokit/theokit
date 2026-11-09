---
"@theokit/agents": minor
---

`@theokit/agents/bridge` exports the `run.events()` timeline translator: `translateTimelineEvent`, `createToolSeen`, `flushPendingToolResults` and the `SdkTimelineEvent` type. A consumer that streams an SDK run's live text deltas translates them into the bridge's `StreamEvent`s with the code the SDK adapter uses, instead of copying it. Nothing that was exported changes. (B-376)
