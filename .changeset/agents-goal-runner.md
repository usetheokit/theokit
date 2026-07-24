---
'@theokit/agents': minor
---

`GoalRunner` — the OO twin of the SDK's free `runGoalLoop` (M59).

The layered boundary continues: the SDK ships goal orchestration as a free function
(`runGoalLoop(agent, goal, options, deps)`); the Theokit layer now imposes its OO shape with a
`GoalRunner` class parallel to `AgentRunner`, so a consumer authors `new GoalRunner(agent).run(goal,
options)` instead of a bare call. Unlike the M58 pass-through barrels, this ENRICHES an orchestration
primitive with a contract — but it DELEGATES, never reimplements (parsimony Rung 9): `run` forwards
verbatim to `runGoalLoop`, so the emitted `GoalEvent` stream and the final `GoalResult` are identical.
A parity test pins that both ways (exact forwarded tuple + identical stream/result).
