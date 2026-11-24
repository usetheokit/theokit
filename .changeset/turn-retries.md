---
'@theokit/agents': patch
---

`@theokit/agents/errors` exports `createTurnRetries`, which reads a run's `rate_limit` events and reports the highest attempt of the current turn, for `describeTurnFailure`'s `attempts` option.
