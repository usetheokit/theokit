---
'@theokit/agents': minor
'@theokit/http': minor
---

`@theokit/http/guards` adds `createGrantStore(file)`: named, scoped, revocable credentials stored as SHA-256 hashes (`create`, `revoke`, `authenticate`). `@theokit/agents/mcp-relay` adds `createMcpRelayServer` and `startMcpRelayConnector`, a reverse relay that lets a hosted MCP client reach a local agent's tools without an open port, filtered by each grant's scopes.
