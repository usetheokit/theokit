---
'@theokit/agents': minor
---

Add `loadMcpServersFile` and `mcpSecretValues` to `@theokit/agents/bridge`: load an MCP servers file from any path under a security policy (absolute commands and cwd, no `envPolicy: all`, a timeout Node can honour, SDK-safe server names, unknown keys refused), and collect the header and env values an output mask should hide.
