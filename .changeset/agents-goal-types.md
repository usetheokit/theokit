---
'@theokit/agents': patch
---

Re-export the goal domain's types alongside `GoalRunner` (M59 follow-up).

`GoalEvent`, `GoalLoopAgent`, `GoalOptions`, `GoalResult` now travel with `GoalRunner` from
`@theokit/agents`, so a consumer types against the goal surface entirely from the Theokit layer
without reaching back to `@theokit/sdk`.
