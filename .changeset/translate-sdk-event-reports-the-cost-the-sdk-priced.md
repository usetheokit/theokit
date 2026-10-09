---
'@theokit/agents': patch
---

`translateSdkEvent` (from `@theokit/agents/bridge`) no longer reports a FINISHED or CANCELLED run as free. Its `done` event carried a hard-coded `cost: 0`, which under the `DoneEvent` contract means "priced at zero", so a stream built on it folded an unpriced run as a known $0 round and the USD ceiling's fail-closed `DelegationBudgetCostUnknownError` never fired. It now follows the same rule as the SDK adapter: a status message whose `result.cost.amountUsd` is a finite number reports that as `cost`, and otherwise the `done` event has no `cost` key. (B-424)
