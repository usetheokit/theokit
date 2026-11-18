---
'@theokit/agents': minor
---

Added `foreignSurfaceInventory` to `@theokit/agents/bridge`: per `.claude` folder, a count the way the loader counts, whether it is read or refused (taken from the gate's surface list), and the entries that could not be read. `reportUnloadedSurfaces` now builds on it with the same warning text.
