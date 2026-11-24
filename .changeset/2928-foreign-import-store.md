---
'@theokit/agents': patch
---

`@theokit/agents/foreign-setup` stores an imported setup for the next start: `writeForeignImport(dir, setup, { now? })` stages, validates and swaps `<dir>/import` atomically (files 0600, directories 0700, a pid lock, recovery of an interrupted swap), `readForeignImport(dir, { onWarn?, env? })` reads it back, and `ForeignImportError` carries a `reason` of `locked`, `refused` or `unreadable`. `plannedForeignImportFiles` lists what a write would create.
