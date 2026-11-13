---
'@theokit/agents': minor
---

`AgentBuilder.withholdBuiltinTools(names)` withholds SDK builtin tools (such as `shell`) on every run path, not only `toAgentFactory`. Unknown names are refused with a `ConfigurationError`; `withholdBuiltinShell` is unioned with it.
