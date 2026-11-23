---
'@theokit/agents': minor
---

`codingAgentPreset` accepts `writeRoot`, `allowAbsolute`, `defaultTimeoutMs`, and caller-built `webFetch`, `webSearch` and `delegateToTeam` tools (gated by default), and `codingAgentTools` exposes its tool half. A capability can report tools that are available but off with a reason (`OffToolsCapability`, `AgentShape.offTools`), and `Toolset.from(tools, profiles)` narrows by a named profile with `narrow(name)`.
