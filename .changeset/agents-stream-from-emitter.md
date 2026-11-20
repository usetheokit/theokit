---
'@theokit/agents': minor
---

Add `streamFromEmitter` to `@theokit/agents/bridge`: it turns a producer that pushes events to a callback into an abortable `AsyncIterable`, for `generateAgentRoutes` and `streamAgentResponse`. `return()` aborts the producer at once unless a final event was already seen.
