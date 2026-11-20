---
'@theokit/agents': minor
---

`@theokit/agents/session` gains `scheduleSessionSweep` and `sweepDecision`: run the cross-project session GC in a detached child on an interval, stamp before spawning, make the first run a dry run, and report the outcome. The child command comes from the app.
