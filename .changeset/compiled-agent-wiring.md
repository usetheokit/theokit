---
'@theokit/agents': minor
---

Added `onWired(listener)` to `AgentBuilder` and `defineAgent`. It reports a `CompiledWiring` (tools, skills listed and readable, MCP servers, hooks, subagents, setting sources, withheld builtins) once per `Agent.create`, read from the final options. Concurrent calls share the SDK's in-flight creation and live-agent cache; only the call that created the agent is reported to. A throwing listener is warned about and does not fail the build.
