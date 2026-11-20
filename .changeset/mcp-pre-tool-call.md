---
'theokit': minor
---

`handleMcpToolsJsonRpc`, `handleMcpJsonRpc` and `handleMcpStdioLine` take an optional `McpToolsOptions` (`plugins`, `hookContext`). The `pre_tool_call` hooks of those plugins run before each MCP `tools/call`; a block or a throwing hook answers with `isError: true` and the tool does not run. `tools/list` is unchanged.
