---
'@theokit/agents': minor
---

`delegate()` now refuses a `budget` or a `parentBudgetRemaining` that is not a finite number above zero, before any hook or round runs, with the `DelegationError` that `AgentRunner` raises for the run option `budget`, naming the field. `Math.min` over a `NaN` gave `NaN`, which every budget check reads as no ceiling, so a delegated sub-agent with `budget: NaN` ran without a limit, and a ceiling of 0 or below was charged one round before it raised.
