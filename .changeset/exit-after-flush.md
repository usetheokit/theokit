---
'@theokit/agents': patch
---

`@theokit/agents/commands` exports `exitAfterFlush`, which waits for stdout and stderr to flush and then exits, bounded by `capMs`.
