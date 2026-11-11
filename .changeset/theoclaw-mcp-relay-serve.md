---
'theoclaw': patch
---

`theoclaw mcp-relay serve --port N [--host H]` runs the hosted MCP relay that remote MCP clients connect to: `POST /mcp` with a client grant token, and `/instance/poll` and `/instance/respond` for the instance, guarded by `THEOCLAW_MCP_RELAY_TOKEN`. (#1635)
