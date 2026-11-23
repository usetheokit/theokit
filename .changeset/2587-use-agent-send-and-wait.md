---
'@theokit/agents': patch
---

`useAgent` now returns `sendAndWait`, which resolves with the turn's settled status when the stream ends, and `asGoalLoopAgent` accepts the hook result, so a React consumer can drive a goal loop without polling.
