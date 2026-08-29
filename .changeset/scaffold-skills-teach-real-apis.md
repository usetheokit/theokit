---
'create-theokit': patch
---

The scaffolded skills no longer teach four APIs that do not exist.

`create-theokit` installs `dot-claude/skills/*` into every generated app, and an AI agent working
inside the consumer's project reads them. Four names they taught are exported by nothing:
`defineAgentTool` (internal — `tool().build()` delegates to it), `defineConfig` (the surface is
`config()`), `defineRoute` (`route()`) and `defineAction` (`action()`); `TheoError` was imported
from the package root, where it does not live — it is in `theokit/server/http`.

Each of those builders is what the scaffold's own files already used. A fresh app shipped the
working call in `agents/tools/weather.ts` and the instruction to write the broken one in the skill
beside it. Six documented imports also read `from 'theokit/server'`, the umbrella that resolves with
a deprecation warning naming a removal release, and now name their real subpaths.

A test asserts every symbol a template doc imports resolves in the built package, so the next wrong
name fails a test instead of reaching a consumer's agent.
