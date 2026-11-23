---
'@theokit/agents': patch
---

The project `.env` step loads every declaration on Node 22.12 too. It hands `util.parseEnv` only the declarations and the lines of their values, so a line with no `=` or no name no longer makes that Node's parser drop every declaration below it.
