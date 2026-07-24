---
'@theokit/agents': patch
---

Fix: the goal domain types (`GoalEvent`/`GoalLoopAgent`/`GoalOptions`/`GoalResult`) are now actually
re-exported from the top-level barrel (the M59 re-export was only reachable from the loop submodule).
