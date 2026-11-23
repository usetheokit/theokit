---
'@theokit/agents': patch
---

`projectEnvStep` loads only `.env` declarations whose name is an identifier, and stops at a quoted value that never closes instead of reading the declarations after it.
