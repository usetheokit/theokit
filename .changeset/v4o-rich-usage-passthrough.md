---
"@theokit/agents": minor
---

V4-O: forward the SDK reasoning/cache token buckets through the adapter `done` event and `DelegationResult`.

`realUsageDone` (`createSdkAgentStream`) now reads `reasoningTokens`/`cacheReadTokens`/`cacheWriteTokens` from `RunResult.usage` and includes them on the `done` event (0 when the provider omits them); the reflective loop folds them per round and accumulates them into `DelegationResult` (alongside the V4-N split usage). The typed `DoneEvent.usage` declares the three optional buckets. Additive + backward-compatible: existing fields unchanged, the new fields are optional, absent buckets default to 0. Lets a consumer (theocode's `LlmUsage`) keep full per-turn usage when it adopts `AgentRunner.stream()` — closes the usage-richness regression the loop-adoption discover found. Reuses the `RunResult.usage` already read by `run.wait()` (Rule 9); no new dependency.
