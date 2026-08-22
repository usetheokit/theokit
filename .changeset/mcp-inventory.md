---
'@theokit/agents': minor
---

`mcpInventory()`, from `@theokit/agents/mcp-health`: the per-server status of the agent's MCP
servers — `loaded`, `failed` or `ignored`, each with its reason.

`loadMcpJson` reads the configuration file; this reads what was observed. A server that failed its
handshake and a server the loader refused both appear, which is what a `/mcp`-style command needs and
what a configuration read cannot give.

Tool-level enumeration is not included and is not planned here: the resolved tool table lives inside
`@theokit/sdk`'s agent loop and no run event carries it.
