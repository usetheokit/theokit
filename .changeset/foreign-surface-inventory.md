---
'@theokit/agents': minor
---

`foreignSurfaceInventory` (from `@theokit/agents/bridge`) counts each folder of a foreign root such as `.claude/` and says whether the framework reads or refuses it. States come from the compat gate's surface list, counts follow the loaders' own rules, and an unreadable entry is listed instead of thrown. `reportUnloadedSurfaces` is now built on it and keeps its warning text.
