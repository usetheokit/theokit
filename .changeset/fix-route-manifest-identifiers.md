---
'theokit': patch
---

Fix `theokit build` failing with `Identifier "Page__id_" has already been declared` when two pages share a dynamic folder name under different parents (`tasks/[id]`, `plans/[id]`). The route manifest now suffixes a colliding component identifier.
