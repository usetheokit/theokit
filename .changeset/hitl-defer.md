---
'@theokit/agents': minor
---

The HITL plugin can defer a gated tool call: set `onDefer` on `HitlWiring` and the call ends the run as deferred with a `DeferredApproval` (including `toolUseId`) for the host to persist. Requires `@theokit/sdk` 5.32.0.
