---
"@theokit/agents": patch
---

Os tipos de configuração de servidor MCP passaram a alcançar a raiz do pacote. Estavam em `types.ts` e
não chegavam ao `index.d.ts` — na prática, o consumidor conseguia *usar* um servidor remoto mas não
conseguia **nomear** o tipo do mapa que `loadMcpJson` devolve, que é metade do problema que o release
anterior resolveu. `McpServerConfig`, `McpServersMap`, `McpStdioServerConfig`, `McpHttpServerConfig`,
`McpAuthConfig` e `McpOAuthConfig` agora atravessam.
