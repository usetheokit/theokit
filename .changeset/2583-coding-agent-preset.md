---
'@theokit/agents': minor
'create-theokit': patch
---

`@theokit/agents` adds `codingAgentPreset({ cwd, sandboxMode, posture, approvals, interactive })`, a `CapabilityPreset` that wires the coding tool set by sandbox mode (no write or shell tool in `read-only`), withholds the built-in shell, gates side-effecting tools, and loads project MCP servers, skills, subagents and hooks only when the trust posture grants `projectSettings`. The scaffold's agents skill shows it.
