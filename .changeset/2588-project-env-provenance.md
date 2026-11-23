---
'@theokit/agents': patch
---

`@theokit/agents/config`: `projectEnvStepWith({ protectedKeys })` refuses listed keys from the project `.env`, and the bootstrap context records `projectEnv` (file, loaded keys, refused keys).
