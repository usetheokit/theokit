---
'theoclaw': patch
---

The `/mcp` endpoint follows the Streamable HTTP transport: it negotiates the protocol version, answers notifications with 202, answers `ping`, rejects batches with a JSON-RPC error and sets `isError: false` on successful tool calls. (#1637)
