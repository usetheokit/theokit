---
'@theokit/agents': minor
---

Added `onWired(listener)` to `AgentBuilder` and `defineAgent`. It reports a `CompiledWiring` (tools, skills listed and readable, MCP servers, hooks, subagents, setting sources, withheld builtins) once per `Agent.create`, read from the final options. A throwing listener is warned about and does not fail the build.
