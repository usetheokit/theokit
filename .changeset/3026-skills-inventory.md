---
'@theokit/agents': patch
---

`checks.skillsInventory` also returns `undeclared` and `missing`, the sorted skill names behind its detail string, so a caller no longer parses the string. Status and wording are unchanged.
