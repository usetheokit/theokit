---
'@theokit/agents': patch
---

`onWired` is now reported by the call that created the agent, decided inside the SDK's own `Agent.getOrCreate`. Concurrent calls for one session share one handle from the SDK's in-flight map and live-agent cache, so an agent is created and reported once, and a cache hit or resume returns the cached handle without a report.
