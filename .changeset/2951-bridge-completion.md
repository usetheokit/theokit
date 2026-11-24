---
'@theokit/agents': patch
---

`completeFromTurn` takes any agent that has `send` and an optional `{ onCancelled: 'throw' | 'complete', onFailure }`; the default still throws on a cancelled run.
