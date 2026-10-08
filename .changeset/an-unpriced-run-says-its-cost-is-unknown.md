---
'@theokit/agents': minor
---

`DelegationResult` gains `costUnknown?: true`, set when at least one round of the run reported no finite cost. The loop folds such a round into `cost` as 0, so `cost` is the spend of the priced rounds, and a run on a model the SDK cannot price returned `{ cost: 0 }` with nothing saying the 0 was not a price. `AgentRunner.run()` and `delegate()` now return `costUnknown: true` for such a run, and a run whose every round was priced returns the same result as before, with no `costUnknown` key. A consumer summing `cost` across runs should check `costUnknown` first. (B-409)
