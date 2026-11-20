---
'@theokit/agents': minor
---

Let a usage record say a run was unpriced. `UsageRecord` gains an optional `priced` (`undefined` means priced), `usageFromRun` builds a record from a run result, `formatUsd` prints a cost to six significant digits, and `InMemoryUsageStorage` totals skip unpriced costs and report them in `unpricedRuns`.
