---
'@theokit/presenter': minor
---

Added `readTurnMetadata` to `@theokit/presenter/wire`, which reads a `finish` chunk's usage, cost, model and `stopReason` as a typed `WireTurnMetadata`, dropping fields of the wrong type. A client can now tell a turn cut at `step_limit` or `no_progress` from one that finished.
