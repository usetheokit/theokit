---
'@theokit/agents': minor
---

`Shutdown.register` now returns a disposer, and `@theokit/agents/commands` exports `exitAfterDrain` for a normal exit that lets output drain. `createShutdown` takes `drain: true` to use it.
