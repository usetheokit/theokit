---
"@theokit/agents": patch
---

A run reports the cost the SDK priced, and none when it has no price. The SDK adapter read `cost.amount`, a field the SDK's `CostBreakdown` does not carry (its USD field is `amountUsd`), so `DoneEvent.cost` and the served finish metadata reported 0 on every run. They now report `amountUsd`. When the SDK has no price for the model, the `cost` key is absent, so an unpriced run no longer reads as a free one; a consumer summing runs must handle the absent key (#969). The `agent.run` span that `@theokit/theo` exports follows the metadata: its `cost.usd` attribute is now absent for an unpriced run, where it used to be 0.

`translateSdkEvent` (from `@theokit/agents/bridge`) follows the same rule and no longer reports a FINISHED or CANCELLED run as free. Its `done` event carried a hard-coded `cost: 0`, which under the `DoneEvent` contract means "priced at zero", so a stream built on it folded an unpriced run as a known $0 round and the USD ceiling's fail-closed `DelegationBudgetCostUnknownError` never fired. Now a status message whose `result.cost.amountUsd` is a finite number reports that as `cost`, and otherwise the `done` event has no `cost` key. (B-424)
