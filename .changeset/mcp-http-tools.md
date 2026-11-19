---
'theokit': minor
---

`theokit/server/agent` exports `handleMcpToolsHttp`, which handles a whole MCP HTTP request (405, `-32700`, batch `-32600`, 202 for notifications). The shared MCP dispatcher now negotiates `protocolVersion` on `initialize`, answers `ping`, sends no reply to a message without `id` (202 over HTTP, no line over stdio) and sets `isError: false` on a successful `tools/call`.
