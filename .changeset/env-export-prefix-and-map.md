---
'@theokit/agents': patch
---

`projectEnvStep` loads `export  NAME=value` declarations with more than one space after `export` on every supported Node version, and the generated `docs/capability-map.md` is regenerated.
