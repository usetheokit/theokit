---
"@theokit/agents": minor
---

Um servidor MCP que o carregador não entende deixou de derrubar os que ele entende, e o transporte
remoto passou a atravessar.

Antes, um `.mcp.json` com um servidor stdio perfeitamente válido e um vizinho que o parser não
reconhecia produzia `McpFileError` — e **os dois** eram perdidos. Fail-closed no raio errado: recusar
*uma entrada* é correto; recusar *o arquivo* transforma "esse servidor não é suportado" em "você não
tem MCP nenhum".

Agora o raio é a entrada:

```jsonc
{ "mcpServers": {
    "local":  { "command": "npx", "args": ["servidor"] },
    "remoto": { "type": "http", "url": "https://…/mcp", "headers": { "Authorization": "…" } }
}}
```

Os dois sobem. Uma entrada inválida é **omitida e NOMEADA** pelo canal `onWarn` — o erro continua
tipado e visível, apenas deixou de ser fatal para os vizinhos. Um arquivo **impartível** (JSON quebrado,
`mcpServers` que não é objeto) continua lançando: ali não há entradas para separar.

**Nenhuma dependência nova.** O transporte remoto já era do SDK — `McpServerConfig` é
`McpStdioServerConfig | McpHttpServerConfig`, com `type`/`url`/`headers`/`auth`/`requestTimeoutMs`.
Este pacote declarava um tipo **mais estreito** e recusava o que o runtime aceita; agora re-exporta o
do SDK. `McpAuthConfig`, `McpHttpServerConfig`, `McpOAuthConfig` e `McpStdioServerConfig` passaram a
atravessar junto.

**Mudança de contrato:** `loadMcpJson` deixa de lançar em defeito de entrada. Quem dependia disso
recebe a entrada omitida e um aviso no `onWarn` opcional; o comportamento em defeito de **arquivo** é
o mesmo de antes.

O valor de `headers` nunca entra num aviso — a mensagem descreve a **forma** do campo, nunca o
conteúdo.
