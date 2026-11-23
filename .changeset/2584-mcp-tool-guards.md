---
'theokit': patch
---

`handleMcpToolsHttp` and `serveMcpToolsStdio` accept `plugins` (and `hookContext`), so a plugin's `pre_tool_call` guard also applies to `tools/call` over MCP.
