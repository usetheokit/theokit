---
'@theokit/agents': patch
---

`applySubagentMemory` now resolves the `user` scope, which it could never resolve before.

It built its input as `{ ...(home === undefined ? {} : { home }) }` while `resolveAgentMemory`
reads `input.homeDir`. Every `user`-scope call threw `memory scope "user" needs a home directory
and none was given` — with a home directory that had been given. `project` and `local` were
unaffected: they read `cwd`, which was never renamed.

TypeScript could not see it. The field arrives through a SPREAD, where excess-property checking
does not apply, and `homeDir` is optional, so its absence is legal. An optional field plus a
spread is a silent rename.

Six tests covered this function and all six declared `project`, so the one root that needs `home`
went through it zero times. Found by wiring the function into a consumer for the first time — the
call that had never existed is what ran the branch that had never run.
