---
"@theokit/agents": patch
---

A run reports the cost the SDK priced, and none when it has no price. The SDK adapter read `cost.amount`, a field the SDK's `CostBreakdown` does not carry (its USD field is `amountUsd`), so `DoneEvent.cost` and the served finish metadata reported 0 on every run. They now report `amountUsd`. When the SDK has no price for the model, the `cost` key is absent, so an unpriced run no longer reads as a free one; a consumer summing runs must handle the absent key (#969).
