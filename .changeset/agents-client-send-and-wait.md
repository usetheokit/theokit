---
'@theokit/agents': minor
---

`AgentClient.sendAndWait` resolves when its own turn settles, and `asGoalLoopAgent` adapts a client to the SDK `GoalLoopAgent` contract so `runGoalLoop` can drive a UI client without polling.
