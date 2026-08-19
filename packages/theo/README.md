# `theokit`

**Build the app your agent lives in.** Routing, auth, real-time, deploy — wired.

This is the framework core: the file-based router, the server surfaces, the Vite plugin, the CLI,
the deploy adapters and the devtools. The agent pipeline lives in
[`@theokit/agents`](https://www.npmjs.com/package/@theokit/agents), the decorator pipeline in
[`@theokit/http`](https://www.npmjs.com/package/@theokit/http), and the runtime in
[`@theokit/sdk`](https://www.npmjs.com/package/@theokit/sdk) — TheoKit compiles and serves; the SDK
runs the agent.

Full documentation, examples and the changelog live in the
[repository](https://github.com/usetheokit/theokit#readme).

## Install

Scaffold rather than install by hand — the app layout is a convention the framework reads:

```bash
npx create-theokit my-app
cd my-app
pnpm dev
```

Node `>= 22.12.0`. Peers: `react`, `react-dom`, `react-router`, `zod`, and — where you use them —
`@theokit/sdk`, `@theokit/ui`, `@theokit/studio`, `ws`, `db0`, `unstorage`.

## The conventions

| Put a file here | Get |
|---|---|
| `app/page.tsx` | the `/` route (`layout` · `loading` · `error` · `not-found` beside it) |
| `app/(group)/pricing/page.tsx` | `/pricing` — the group organizes without entering the URL |
| `agents/support.ts` | `POST /api/agents/support`, bound on the client by `useAgent` |
| `server/routes/users.ts` | `/api/users`, one export per HTTP verb |
| `server/actions/*.ts` | server actions, with CSRF and validation handled |
| `server/controllers/*.ts` | `@Controller` classes |
| `server/ws/chat.ts` | `ws://…/ws/chat` |
| `server/middleware/01-cors.ts` | request middleware, in filename order |

## Authoring surfaces

Every surface is a fluent builder whose `.build()` is a compile error while a required link is
missing:

```typescript
import { route, action, websocket, middleware, tool, plugin } from 'theokit/server'

export const GET = route()
  .query(z.object({ search: z.string().optional() }))
  .handler(({ query }) => ({ results: search(query.search) }))
  .build()
```

## Subpaths

| Subpath | What lives there |
|---|---|
| `.` | `config()` and the framework entry |
| `./server` | The authoring builders plus every `server/*` capability re-exported |
| `./server/{agent,auth,cost,cron,define,http,jobs,observability,plugins,rate-limit,realtime,scan,security,storage,webhook}` | The capabilities on their own doors |
| `./client` | `theoFetch`, `useAgent`, `Link`, `Metadata`, `Image`, the transports |
| `./client/core` | The framework-agnostic client (no React) |
| `./react-query` | The TanStack Query adapter over `theoFetch` |
| `./vite-plugin` | The plugin that makes all of the above work |
| `./boot`, `./adapters/web-shim`, `./adapters/ws-shim` | Runtime shims |

## CLI

```bash
theokit dev | build | start          # build takes --target <adapter>
theokit generate <type> <name>       # page, route, action, ws, controller, agent, toolbox, …
theokit agent <name> [message]       # run an agent in the terminal, approvals included
theokit routes | check | doctor | info
theokit openapi | db <action> | migrate <kind> | docker | add <package>
theokit mcp <agent>                  # serve an agent as an MCP server over stdio
```

## Deploy

`theokit build --target <name>`: `node` (default), `theo-cloud`, `vercel`, `netlify`,
`cloudflare`, `bun`, `deno-deploy`, `aws-lambda`, `static`.

## Licence

Apache-2.0 — see `LICENSE`.
