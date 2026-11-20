---
'@theokit/agents': minor
---

`defineLayeredConfig` (from `@theokit/agents/config`) resolves defaults, user, project, project-local, a selected profile, env, cli and managed layers in that order. Floored keys (`SecurityFloorSpec`) can only be tightened by restricted layers, and a managed value for any key is the final value. A schema error names its layer, and an unknown selected profile throws naming it.
