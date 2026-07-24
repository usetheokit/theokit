# MCP — Model Context Protocol

Model Context Protocol (MCP) lets agents connect to external tool servers without you
writing any tool code. An MCP server exposes tools, resources, and prompts over a
standard protocol — the agent discovers and calls them the same way it calls any other
tool.

Use MCP when the tool you need already has a server (GitHub, Notion, Postgres, Brave
Search, Filesystem, Slack...) rather than writing a `defineAgentTool` from scratch.

---

## Quickstart — stdio server

Connect a local MCP server via the `@MCP` decorator on the `@Agent` class:

```ts
// agents/dev-agent.ts
import {
  applyCapabilities,
  AgentConfigCapability,
  ModelCapability,
  mcpServers,
} from '@theokit/agents'

export const devAgent = applyCapabilities([
  new ModelCapability('anthropic/claude-sonnet-4-6'),
  new AgentConfigCapability({
    systemPrompt: 'You are a developer assistant. Use the GitHub and filesystem tools as needed.',
  }),
  mcpServers({
    github: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_TOKEN! },
    },
    filesystem: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', process.cwd()],
    },
  }),
])
```

`mcpServers()` maps server names to their launch configuration. The SDK starts each server as a
subprocess when the agent initializes, connects via stdio, and registers all the server's
tools on the agent automatically.

---

## stdio server options

```ts
{
  command: 'npx',                 // executable (required)
  args: ['-y', '@mcp/server'],    // command-line arguments
  env: { API_KEY: '...' },        // environment variables for the server process
  cwd: '/path/to/dir',            // working directory (local agents only)
  requestTimeoutMs: 30_000,       // per-request timeout (default: 30s)
  envPolicy: 'inherit-scrubbed',  // 'inherit-scrubbed' (default) | 'all'
}
```

**`envPolicy`**: by default, the SDK strips secret-like host environment variables
(`*KEY*`, `*SECRET*`, `*TOKEN*`, `*PASSWORD*`, `*_AUTH*`) from the spawned process to
prevent a third-party MCP server from exfiltrating credentials. Pass explicit `env` values
to grant specific variables. Set `envPolicy: 'all'` to grant full env inheritance.

---

## HTTP/SSE server

For remote MCP servers (hosted endpoints):

```ts
import { Agent } from '@theokit/sdk'

const agent = await Agent.create({
  model: 'anthropic/claude-sonnet-4-6',
  local: { cwd: process.cwd() },
  mcpServers: {
    notion: {
      type: 'http',
      url: 'https://mcp.notion.so/v1',
      headers: { Authorization: `Bearer ${process.env.NOTION_TOKEN}` },
      requestTimeoutMs: 20_000,
    },
  },
})
```

| Field | Description |
|---|---|
| `type` | `'http'` or `'sse'` (autodetected from URL if omitted) |
| `url` | Server endpoint URL |
| `headers` | Static headers sent with every request |
| `auth` | OAuth 2.1 PKCE config (see below) |
| `requestTimeoutMs` | Per-request timeout in ms (default: 30s) |

---

## OAuth 2.1 PKCE for HTTP servers

For MCP servers that require OAuth rather than a static token:

```ts
mcpServers: {
  googleDrive: {
    type: 'http',
    url: 'https://mcp.googleapis.com/v1',
    auth: {
      CLIENT_ID: process.env.GOOGLE_CLIENT_ID!,
      CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET!,
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
      oauth: {
        authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenEndpoint: 'https://oauth2.googleapis.com/token',
        redirectMode: 'localhost',   // opens browser, catches callback on a local port
      },
    },
  },
}
```

On first use, the SDK runs the PKCE flow (opens the browser), stores the tokens locally
(keychain or file), and refreshes them automatically on subsequent runs.

---

## Using MCP with the fluent builder

The `@MCP` decorator is for the class surface. With the fluent builder:

```ts
import { AgentBuilder } from '@theokit/agents'

export default AgentBuilder.create()
  .model('anthropic/claude-sonnet-4-6')
  .mcpServers({
    github: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
    },
  })
  .build()
```

---

## Using MCP with `defineAgent`

```ts
import { defineAgent } from '@theokit/agents'

export default defineAgent({
  model: 'anthropic/claude-sonnet-4-6',
  mcpServers: {
    postgres: {
      command: 'npx',
      args: ['-y', '@mcp/server-postgres', process.env.DATABASE_URL!],
    },
  },
})
```

---

## Multiple servers

An agent can connect to as many MCP servers as needed. The agent discovers all tools from
all connected servers and can call any of them during a run:

```ts
export const researchAgent = applyCapabilities([
  new ModelCapability('anthropic/claude-sonnet-4-6'),
  mcpServers({
    github: { command: 'npx', args: ['-y', '@mcp/server-github'] },
    slack: { command: 'npx', args: ['-y', '@mcp/server-slack'] },
    browser: { command: 'npx', args: ['-y', '@mcp/server-puppeteer'] },
    postgres: { command: 'npx', args: ['-y', '@mcp/server-postgres', DATABASE_URL] },
  }),
])
```

> **Migrating from `@MCP`?** The decorator was removed in `@theokit/agents` v1.0 (M53).
> See [`MIGRATION.md`](../../MIGRATION.md).

---

## Where to find MCP servers

The MCP ecosystem has a growing catalog:

- [`modelcontextprotocol.io`](https://modelcontextprotocol.io) — official reference servers
- [`mcp.so`](https://mcp.so) — community server registry
- Package search: `@modelcontextprotocol/server-*`, `@mcp/server-*`

Popular servers: GitHub, GitLab, Postgres, MySQL, SQLite, Filesystem, Brave Search,
Puppeteer, Notion, Linear, Slack, Google Drive, AWS S3.

---

## Expose your agent AS an MCP server (M16)

TheoKit serves any agent as an MCP server over its own HTTP route — external MCP clients call
`POST /api/agents/<name>/mcp` with JSON-RPC 2.0. Two core methods are answered: `initialize`
(server info + `capabilities.tools`) and `tools/list` (the agent's tools as MCP descriptors).

```ts
// buildMcpToolDescriptors / mcpServerInfo (@theokit/agents) power the served endpoint.
// An external MCP client connects with: { type: 'http', url: 'https://app.com/api/agents/ops/mcp' }
```

Shipped in `@theokit/agents@0.31.0` + `theokit@0.16.0`. The stdio transport for exposing the
server stays SDK-side.

## What TheoKit doesn't have (yet)

**Dynamic toolsets** — Mastra's `listToolsets()` lets different MCP tool credentials be
supplied per-request (useful for multi-tenant apps where each user has their own API keys).
TheoKit MCP servers are configured once at agent creation time.

---

## Per-request config + registries + tool approval (M24)

Three framework-side helpers over the `@MCP` config (the SDK still owns MCP server execution):

```ts
import { resolveMcpServers, mcpRegistry, mcpToolApprovals } from '@theokit/agents'

// Multi-tenant: different MCP creds per request.
const servers = await resolveMcpServers((ctx) => ({
  github: { command: 'npx', args: ['-y', 'server-github'], env: { TOKEN: ctx.userToken } },
}), requestCtx)

// Known registry (Composio / mcp.run).
const composio = mcpRegistry({ registry: 'composio', apiKey: process.env.COMPOSIO_API_KEY, apps: ['github'] })

// Gate MCP tools through the M14 HITL flow.
defineAgent({ approvals: mcpToolApprovals({ github_delete_repo: 'DELETE a repository?' }) })
```

`@theokit/agents@0.32.0`.

## MCP Apps — `ui://` iframe UIs (M30)

An MCP tool can declare a `ui://` HTML resource; the server serves it via `resources/list` +
`resources/read`, and the client renders it in a **sandboxed** iframe with a capability-scoped
guest API.

```ts
import { defineAppResource } from 'theokit/server'
import { mountMcpApp } from 'theokit/client'

const card = defineAppResource({ uri: 'ui://weather/card', name: 'Weather', html: '<h1>Sunny</h1>' })

// Client: sandbox="allow-scripts" ONLY (never allow-same-origin → null origin).
mountMcpApp(container, card, {
  onCallServerTool: (tool, args) => callTool(tool, args),
})
```

`theokit@0.17.0`.

**Per-agent declaration (M30 wiring):** an `agents/<name>.ts` module exports its `ui://` resources
alongside the agent — the MCP endpoint (`POST /api/agents/<name>/mcp`) then advertises + serves them
(`resources/list` / `resources/read`) in dev AND prod:

```ts
// agents/weather.ts
export default defineAgent({ /* ... */ })
export const appResources = [
  defineAppResource({ uri: 'ui://weather/card', name: 'Weather', html: '<h1>Sunny</h1>' }),
]
```



## Serve over stdio — `theokit mcp <agent>` (M16 follow-up)

For a desktop MCP client (e.g. Claude Desktop) that spawns a subprocess and talks over a pipe, serve
an agent as a **stdio** MCP server — the sibling of the HTTP route, over the same `handleMcpJsonRpc`:

```jsonc
// claude_desktop_config.json
{ "mcpServers": { "support": { "command": "theokit", "args": ["mcp", "support"] } } }
```

`theokit mcp <agent>` reads newline-delimited JSON-RPC from stdin and writes responses to stdout
(`initialize` / `tools/list` / `resources/list` / `resources/read`). It reuses the framework handler
— no LLM call, no runtime (a transport). This is the SERVER side; the SDK's MCP *client* stdio
(consuming external `mcpServers`) is separate and SDK-side. `theokit@0.19.0`.

## Related

- [Using tools](./using-tools.md) — define custom tools alongside MCP tools
- [Overview](./overview.md) — agent fundamentals
- [Run context](./run-context.md) — pass per-request config to tool handlers
