---
'@theokit/agents': minor
---

`createPermissionsPlugin` now requires a gate for the `ask` verdict, and `AgentBuilder` gained
`.subagents()`.

The gate is mandatory rather than optional because its absence had a silent, catastrophic default:
`PermissionEngine` answers `ask` for a tool no rule matches, and the SDK turns that into a hard block
when nothing answers it. Wiring the engine without a gate made every tool an operator had not
enumerated stop working, the moment they wrote any `permissions` block at all.

`.subagents()` supplies subagent definitions by name, reaching `AgentOptions.agents`. It is distinct
from `settingSources`, which discovers them: the framework reads `.claude/agents/<name>.md` and takes
the prompt from the file, so a caller that enriched a definition — `applySubagentMemory` folding in a
`MEMORY.md` is the measured case — had nowhere to put the result and it was silently discarded.
