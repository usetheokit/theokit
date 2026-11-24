---
'@theokit/agents': patch
---

`loadMcpScopes` warns and loads no project servers when `<cwd>/.mcp.json` is malformed, as it already did for a personal file, instead of throwing and losing the personal servers.
