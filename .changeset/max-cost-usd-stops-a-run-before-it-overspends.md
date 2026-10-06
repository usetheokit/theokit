---
'@theokit/agents': minor
---

The run option `budget` now also accepts `{ maxCostUsd }`, which is the run's USD ceiling; `window` is refused before any round, because a single run cannot keep a rolling budget. A run that used to finish one round over its ceiling now stops one round earlier: before each round after the first, the loop assumes the next round costs what the last one did and refuses it when that would pass the ceiling, with a `DelegationBudgetExceededError` whose message names the spend, the projection and the limit. A run with a ceiling now also stops after a round whose cost is not known, with the new `DelegationBudgetCostUnknownError`, a subclass of `DelegationBudgetExceededError` (#970).
