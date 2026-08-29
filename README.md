# TheoKit

**Build the app your agent lives in.** Routing, auth, real-time, deploy — wired.

Part of the [Theo](https://usetheo.dev) family of products. TheoKit is the **web framework** layer — independent and self-contained, with **TheoCloud** as its principal deploy target. See [the Ecosystem section](#ecosystem) for how it relates to its siblings.

[![License](https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square)](./LICENSE)
[![Status](https://img.shields.io/badge/status-beta-yellow?style=flat-square)](#status)
[![CI](https://img.shields.io/github/actions/workflow/status/usetheokit/theokit/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/usetheokit/theokit/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/theokit?style=flat-square&label=theokit)](https://www.npmjs.com/package/theokit)
[![npm](https://img.shields.io/npm/v/@theokit/agents?style=flat-square&label=@theokit/agents)](https://www.npmjs.com/package/@theokit/agents)
[![npm](https://img.shields.io/npm/v/@theokit/http?style=flat-square&label=@theokit/http)](https://www.npmjs.com/package/@theokit/http)

## Quick Start

```bash
npx create-theokit my-app
cd my-app
pnpm dev
```

Node `>= 22.12.0` is required — every manifest declares it and the CLI refuses to
start below it rather than failing later somewhere unrelated.

## Your first agent in 5 minutes

The scaffold ships a working agent chat, so the five minutes are spent reading it,
not assembling it.

1. Point the agent at a provider. The SDK resolves the key from the environment —
   OpenRouter (preferred), Anthropic, or OpenAI:

   ```bash
   echo 'OPENROUTER_API_KEY=sk-or-v1-...' >> .env
   ```

2. **An agent is a file.** `agents/chat.ts` is served at `POST /api/agents/chat` —
   there is nothing to register:

   ```ts
   // agents/chat.ts
   import { AgentBuilder } from '@theokit/agents'
   import { z } from 'zod'

   import { weatherTool } from './tools/weather.js'

   export default AgentBuilder.create()
     .input(z.object({ message: z.string() }))
     .model('openai/gpt-4o-mini')
     .system('You are a helpful assistant.')
     .tool(weatherTool)
     // Human-in-the-loop: pause the run and ask before this tool executes.
     .approval('weather', { question: 'Look up the weather?' })
     .build()
   ```

3. **A tool is a file too** — pure metadata plus a handler. It never calls an LLM;
   the agent decides when to invoke it:

   ```ts
   // agents/tools/weather.ts
   import { tool } from 'theokit/server'
   import { z } from 'zod'

   export const weatherTool = tool('weather')
     .describe('Get the current weather for a city or place name.')
     .input(z.object({ location: z.string() }))
     .execute(async ({ location }) => `It is sunny in ${location}.`)
     .build()
   ```

4. **The client binds by name**, and streams:

   ```tsx
   import { useAgent } from 'theokit/client'

   const { thread, send, status, reset, error } = useAgent<{ message: string }>('/api/agents/chat')
   ```

`.build()` is a compile error if you never called `.model()`, and `.tool(t)` is a
compile error if the tool needs a run-context the agent did not declare. The
type-state is the point: the mistakes surface in your editor, not in production.

## What You Get

- **Routes are just files** — `app/page.tsx` → `/`. Layouts, errors, loading, not-found — no config.
- **Route groups** — `app/(marketing)/pricing/page.tsx` → `/pricing`. Organize without affecting URLs.
- **Agents are just files** — `agents/support.ts` → `POST /api/agents/support`, bound by `useAgent`.
- **The authoring surface is a typed builder** — `AgentBuilder.create()` accumulates type-state, so an unset model or a context-hungry tool fails at compile time.
- **APIs that validate themselves** — Zod schemas in, types out, end-to-end.
- **NestJS-style decorators** — `@Controller`, `@Get`, `@Post`, `@Body(Zod)`, `@UseGuards`, `@UseInterceptors`, `@UseFilters` for structured HTTP pipelines.
- **Convention over configuration** — `@Controller()` on `UsersController` infers the `api/users` prefix. An agent's name is its filename.
- **Human-in-the-loop, guardrails, skills, MCP** — approval gates per tool, input/output guards at the boundary, on-demand skill loading, MCP servers — all links in the same chain.
- **Server actions without plumbing** — CSRF, validation, serialization handled.
- **Backend calls that compile** — import the route type, get request and response inferred.
- **Sessions that just work** — encrypted cookies with key rotation, one helper to require a logged-in user.
- **WebSocket as a file** — drop a file in `server/ws/`, it's a real-time endpoint.
- **SDK is the only agent runtime** — `@theokit/sdk` handles LLM calls, tool execution, conversation persistence. No reimplemented runners.
- **Nine deploy targets** — node, vercel, cloudflare, netlify, bun, deno-deploy, aws-lambda, static, and TheoCloud.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        User Application                             │
│  app/           Frontend — file-based routing + route groups        │
│  agents/        Agents — one file per agent, plus tools/ prompts/   │
│  server/        Backend — routes, actions, controllers, ws          │
└─────────────────────────────────────────────────────────────────────┘
                              │
    ┌───────────────┬──────┴────────┬─────────────────┐
    ▼               ▼               ▼                 ▼
┌────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────────┐
│  theokit   │ │@theokit/http │ │@theokit/agents│ │@theokit/presenter│
│  router    │ │ decorators   │ │ AgentBuilder  │ │ one event,       │
│  server    │ │ pipeline     │ │ compiler      │ │ N surfaces:      │
│  vite+cli  │ │ typed client │ │ guardrails    │ │ web·term·json    │
└────────────┘ └──────────────┘ └───────┬──────┘ └──────────────────┘
                                        ▼
                                  @theokit/sdk
                                  Agent.create()
                                  the only runtime
```

**Key design decisions:**

- HTTP and AI run through **distinct execution pipelines** — not the same middleware chain. A file-based agent is gated in its own chain, with `.approval()`, `.guardrail()` and `.hooks()`. Guards become shared only where the two surfaces meet: an agent bound to a controller property with `@Expose` is served through the controller's dispatch, so the controller's `@UseGuards` protects it (interceptors do not run on that path).
- **Agent authoring is builder-only.** The `@Agent` / `@Tool` / `@Toolbox` / `@MainLoop` decorators were removed from the public API (ADR-0043); their implementations remain internal, read by the compiler. `AgentBuilder.create()` and `tool()` are the single authoring surface.
- `@theokit/sdk` is the **only** agent runtime. TheoKit compiles definitions and owns the surface; the SDK owns the loop, the providers, and conversation persistence.
- A tool always requires an explicit name, description, and input schema — no implicit capability exposure.

## Project Structure

```
my-app/
├── agents/                    # The agent, and what composes it
│   ├── chat.ts                #   → POST /api/agents/chat, useAgent('/api/agents/chat')
│   ├── prompts/               #   system prompts / personas
│   ├── tools/                 #   tools the agent can call
│   └── skills/                #   procedures the model loads on demand
├── app/                       # Pages — file-based routing + route groups
│   ├── page.tsx               #   /
│   ├── layout.tsx             #   root layout
│   ├── (marketing)/           #   route group (not in the URL)
│   │   └── pricing/page.tsx   #   /pricing
│   ├── components/            #   presentational UI (never routes)
│   ├── hooks/                 #   custom hooks — where state lives
│   └── lib/                   #   app modules / config
├── server/                    # Backend — explicit and typed
│   ├── routes/                #   API routes (route() builder)
│   ├── actions/               #   server actions (action() builder)
│   ├── controllers/           #   @Controller classes
│   ├── middleware/            #   request middleware (alphabetical; use 01-, 02- prefixes)
│   ├── ws/                    #   WebSocket endpoints
│   └── context.ts             #   createContext() — what every handler sees as `ctx`
├── shared/                    # Code imported by more than one layer
├── theo.config.ts             # Framework config
└── package.json
```

The sub-folders under `agents/` are **semantic, not routes**. Thirteen names are reserved
as composition concerns — `tools skills prompts lib hooks channels connections subagents
schedules sandbox workflows evals memory` — so `agents/tools/weather.ts` never becomes a
phantom `/api/agents/tools/weather` endpoint. An agent that outgrows one file becomes a
folder instead: `agents/<name>/index.ts` with its own `tools/` and `prompts/` beside it.

Same idea in `app/`: a folder is a route only when it holds a
`page`/`layout`/`loading`/`error`/`not-found` file, so `components/`, `hooks/` and `lib/`
sit next to the routes without becoming any.

## Agents (`@theokit/agents`)

### The builder

Every link returns a new builder type, so what you have set is visible to the compiler.

| Group | Methods |
|---|---|
| **Contract** | `.input(schema)`, `.model(id)`, `.system(prompt)`, `.reasoningEffort(effort)`, `.context(value)` |
| **Capabilities** | `.tool(t)`, `.tools([...])`, `.skills(selection)`, `.mcp(servers)`, `.plugins([...])` |
| **Policy** | `.approval(tool, options)`, `.approvals(map)`, `.guardrail(g)`, `.guardrails([...])`, `.hooks(map)` |
| **State** | `.memory(settings)`, `.settingSources(selection)` |
| **Composition** | `.use(preset)`, `.when(condition, apply)`, `.build()` |

`.use(preset)` applies a reusable sub-chain and carries its type-state through;
`.when(cond, apply)` skips a link mid-chain without collapsing what came before.

### Guardrails

Pluggable input/output guards that run at the framework boundary, before the SDK:

```ts
import { promptInjectionDetector, piiDetector, costGuard } from '@theokit/agents'

AgentBuilder.create()
  .model('openai/gpt-4o-mini')
  .guardrails([promptInjectionDetector(), piiDetector(), costGuard({ maxTokens: 100_000 })])
  .build()
```

Also shipped: `unicodeNormalizer`, `outputModeration`, and `moderateOutputStream`
for streaming responses.

### Stream events

A discriminated union of 18 variants, opened by `run_started` and closed by `done` or `error`:

| Group | Variants |
|---|---|
| Output | `text_delta`, `thinking`, `artifact_start`, `artifact_chunk` |
| Tools | `partial_tool_call`, `tool_call`, `tool_result`, `shell_output`, `file_edit` |
| Control | `run_started`, `iteration`, `task_progress`, `state_update`, `checkpoint_saved` |
| Human | `approval_required`, `input_requested` |
| Terminal | `done`, `error` |

Type guards ship with the union: `isTextDelta`, `isToolCall`, `isPartialToolCall`,
`isToolResult`, `isApprovalRequired`, `isDone`, `isError`.

### Multi-agent delegation

```typescript
import { delegate } from '@theokit/agents/bridge'

const result = await delegate(
  { name: 'research', compiled: compiledResearchAgent },
  'Find papers on RAG',
  {
    apiKey: process.env.API_KEY,
    budget: 0.5,                  // USD cap for this delegation
    parentBudgetRemaining: 1.0,   // clamped to min(budget, parent)
    parentTools: compiledTools,   // inherited tools (sub-agent wins on collision)
    parentHooks,                  // the member runs under the parent's authority
  },
)
```

Budget is clamped at delegation and enforced mid-stream; each delegation gets an
isolated session.

## HTTP Decorators (`@theokit/http`)

NestJS-compatible decorator system on Web Standards (`Request`/`Response`, not `node:http`).

```typescript
import { Controller, Get, Post, Body, Param, UseGuards, HttpCode, HttpStatus } from '@theokit/http'
import { z } from 'zod'

// Convention: @Controller() on UsersController → prefix "api/users"
@Controller()
@UseGuards(AuthGuard)
class UsersController {
  @Get()
  async list() {
    return { users: await db.users.findAll() }
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body(z.object({ name: z.string(), email: z.string().email() })) body) {
    return db.users.create(body)
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return db.users.findById(id)
  }
}
```

### Pipeline

`middleware → guards → interceptors → handler`, with filters catching what escapes.

```typescript
import { HttpException } from '@theokit/http'
import type { ArgumentsHost, CanActivate, ExecutionContext, Interceptor } from '@theokit/http'

// Guards — decide whether the request enters. `false` answers 403.
class AuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    return ctx.getRequest().headers.get('authorization') !== null
  }
}

// Interceptors — wrap the handler call. Skip `next()` and the handler never runs.
class TimingInterceptor implements Interceptor {
  async intercept(request: Request, next: () => Promise<unknown>): Promise<unknown> {
    const start = Date.now()
    const result = await next()
    console.log(`${request.method} ${request.url} — ${Date.now() - start}ms`)
    return result
  }
}

// Exception filters — turn what was thrown into a Response.
class HttpErrorFilter {
  catch(error: unknown, host: ArgumentsHost): Response {
    const status = error instanceof HttpException ? error.statusCode : 500
    return Response.json({ error: String(error), path: host.getRequest().url }, { status })
  }
}
```

An `ExecutionContext` carries `getRequest()`, `getUrl()`, `getClass()` and `getMethodName()` —
enough for a guard to decide, and no response to mutate before there is one.

### Available decorators

| Category | Decorators |
|---|---|
| **Routing** | `@Controller`, `@Get`, `@Post`, `@Put`, `@Patch`, `@Delete`, `@Options`, `@Head`, `@All` |
| **Parameters** | `@Body`, `@Param`, `@Query`, `@Headers`, `@Session`, `@Req`, `@Res`, `@Ip`, `@HostParam` |
| **Response** | `@HttpCode`, `@Header`, `@Redirect` |
| **Pipeline** | `@UseGuards`, `@UseInterceptors`, `@UseFilters`, `@Catch` |
| **Policies** | `@Throttle`, `@SkipThrottle` |
| **Metadata** | `@SetMetadata`, `createDecorator` + `Reflector` |
| **Agents** | `@Expose` (bind a built agent to a controller property) |

`createDecorator` is how you build your own: `const Roles = createDecorator<string[]>()`,
then read it back in a guard with `reflector.get(Roles, handler)`.

`@Expose` is where the HTTP and AI surfaces meet. It binds an agent built in
`agents/<name>.ts` to a controller property, serving it at `POST <prefix>/<property>`
through `mountAgent` — the one runtime, never a parallel one. The exposure, its route
and its auth then sit in a single code review:

```typescript
import { Controller, Expose, UseGuards } from '@theokit/http'

import supportAgent from '../../agents/support.js'

@Controller('api/agents')
@UseGuards(AuthGuard)
class AgentsController {
  @Expose(supportAgent)
  support!: unknown // → POST /api/agents/support, behind AuthGuard
}
```

Guards run on that route (`middleware → guards → handler`); interceptors do not,
because the dispatcher delegates straight to the agent runtime.

`HttpStatus` carries the 30 status codes the framework actually uses —
`HttpStatus.OK`, `HttpStatus.CREATED`, `HttpStatus.TOO_MANY_REQUESTS`, and so on.

### `.plugins([...])` is not `@theokit/plugin-*`

Two unrelated things wear the word, and both appear in this README:

| | What it is | Where it goes |
|---|---|---|
| `@theokit/plugin-canvas`, `@theokit/auth-github`, … | **framework** plugins — routes, UI, devtools, CLI verbs | installed in the app, declared in its config |
| `.plugins([...])` on the builder | **SDK** plugins — `PermissionPlugin`, `Handoff` — they extend the agent | passed through to `Agent.create` |

Installing `@theokit/plugin-payments` does nothing for an agent; passing `PermissionPlugin` does
nothing for a route. The SDK's own option additionally has two mutually exclusive forms — see
[`@theokit/sdk`'s README](https://github.com/usetheokit/theokit-sdk#three-things-are-called-plugin).

## Server Routes

```typescript
// server/routes/users.ts
import { route } from 'theokit/server'
import { z } from 'zod'

export const GET = route()
  .query(z.object({ search: z.string().optional() }))
  .handler(({ query }) => ({ users: [{ name: 'Alice' }], search: query.search }))
  .build()

export const POST = route()
  .body(z.object({ name: z.string().min(1), email: z.string().email() }))
  .status(201)
  .handler(({ body }) => ({ id: crypto.randomUUID(), ...body }))
  .build()
```

`.params(schema)` types the path params, `.response(schema)` validates the return at
runtime, and `.csrf(false)` opts a webhook or OAuth callback out of CSRF enforcement.
`.build()` is a compile error before `.handler()`.

## Typed Client

```typescript
import { theoFetch } from 'theokit/client'
import type { GET } from '../../server/routes/users'

const data = await theoFetch<typeof GET>('/api/users', {
  query: { search: 'alice' }
})
// data is typed as { users: { name: string }[] }
```

`theokit/client` also ships `Link` (with route prefetch), `Metadata`, `Image`,
`useAgent`, and the `theokit/react-query` adapter.

### Navigation

`Link` prefetches the route it points at. The strategy decides how many requests
that costs, so it is stated here rather than left to be discovered in a network
panel — for a viewport holding **N** prefetchable links:

| `prefetch` | Requests | When they fire |
|---|---|---|
| `intent` *(default)* | one per link the reader hovers or focuses | ~200 ms before a click, so a click that never happens still cost a request |
| `viewport` | **N** — every link visible | as each link enters the viewport |
| `none` | zero | never |

Each URL is fetched at most once per session, so a second hover over the same
link is free. `viewport` on a long index page is the case worth thinking about:
it is the fastest option for the reader and the only one whose cost scales with
the page rather than with what the reader does.

Scroll position is restored on back navigation. The router mounts restoration at
the root, and the document needs no application code.

**An element that scrolls has to say so.** A layout that scrolls an inner element
instead of the document — `h-full` with `overflow-hidden` on a wrapper, which is
what the default scaffold ships — leaves the document with no offset to save, and
browsers and react-router alike restore only the document. Mark the element and
its offset is restored too:

```tsx
<main data-theo-scroll="main" className="overflow-y-auto">…</main>
```

The attribute's value is the id, so a page with two scrollers stays unambiguous.
It is declared rather than detected on purpose: walking the DOM for
`overflow: auto` picks one container silently, and picks a different one as the
layout changes. Measured in a browser on 2026-08-22, before this existed: the
offset of an inner container was not restored across a back navigation.

## Auth

```typescript
import { createSessionManager, requireAuth, route } from 'theokit/server'

const auth = createSessionManager<{ userId: string }>({
  secret: process.env.SESSION_SECRET!, // min 32 chars; pass an array to rotate keys
})

export const GET = route()
  .handler(({ ctx }) => {
    requireAuth(ctx.user) // throws AuthRequiredError (401) if null, narrows the type
    return { userId: ctx.user.userId }
  })
  .build()
```

`ctx` is whatever `server/context.ts` returns from `createContext({ request, response })` —
that factory is what puts `user` there, and its return type is the `ctx` every handler sees.

Cookies are encrypted and `httpOnly`. The array form of `secret` (max 5) enables
dual-key rotation: encryption always uses the newest, decryption walks the list and
transparently re-encrypts on a hit against an older key.

## WebSocket

```typescript
// server/ws/chat.ts → ws://localhost:3000/ws/chat
import { websocket } from 'theokit/server'

export default websocket()
  .onOpen((ws) => ws.send('connected'))
  .onMessage((ws, data) => ws.send(`echo: ${data}`))
  .build()
```

`.onClose()` and `.onError()` complete the surface.

## CLI

```bash
theokit dev                              # Dev server with HMR
theokit build                            # Production build (--target <adapter>)
theokit start                            # Production server (serves the last build)
theokit preview                          # Build, then serve it — one step
theokit generate page dashboard          # Scaffold a page
theokit generate route users             # Scaffold an API route
theokit generate agent support           # Scaffold an agent
theokit generate resource posts title:string  # Scaffold a full resource (name:type fields)
theokit agent support "hello"            # Run an agent in the terminal (stream + approvals)
theokit agent sessions gc                # Collect old transcripts (dry run unless --apply)
theokit mcp support                      # Serve an agent as an MCP server over stdio
theokit routes                           # List all routes, actions and WebSocket endpoints
theokit check                            # Typecheck + scan (+ eslint)
theokit doctor                           # Report the resolved state of the installation
theokit info                             # Print environment info
theokit openapi                          # Emit openapi.json from route schemas
theokit db migrate                       # Database: migrate | generate | seed
theokit migrate router                   # One-shot convention migrations
theokit add <package>                    # Install a known adapter or plugin (whitelist-only)
theokit docker                           # Generate a production Dockerfile
```

`theokit generate` also knows `action`, `ws`, `controller`, `toolbox`, `workflow`,
`eval`, `sandbox`, `schedule`, and `memory`.

## Configuration

```typescript
// theo.config.ts
import { config } from 'theokit'

export default config()
  .port(3000)
  .ssr(false)
  // Named setters: name, port, host, ssr, appDir, serverDir, agentsDir, distDir.
  // `.set()` carries anything else.
  .set({ rateLimit: { windowMs: 60_000, max: 100 } })
  .build()
```

Defaults: `appDir: 'app'`, `serverDir: 'server'`, `agentsDir: 'agents'`.

## Deploy

`theokit build --target <name>` selects the adapter:

| Target | Notes |
|---|---|
| `node` | Default — a self-contained Node server |
| `theo-cloud` | **Principal target.** Validates `.theokit/services.json` and prepares the bundle; TheoCloud emits the K8s manifests on its side |
| `vercel`, `netlify`, `cloudflare` | Platform adapters |
| `bun`, `deno-deploy`, `aws-lambda` | Alternative runtimes |
| `static` | Prerendered output |

## Built With

| Layer | Technology |
|---|---|
| Bundler + Dev Server | Vite 6 |
| UI Framework | React 19 |
| Routing (client) | react-router 7 |
| Type Validation | Zod 4 |
| Build | tsup |
| Testing | Vitest 4 (unit, integration, type-level) |
| Agent Runtime | `@theokit/sdk` |

## Packages

### TheoKit (this repo)

| Package | Version | Description |
|---|---|---|
| [`theokit`](https://www.npmjs.com/package/theokit) | ![npm](https://img.shields.io/npm/v/theokit?style=flat-square&label=) | Framework core — router, server, CLI, config, adapters, devtools, the agent mount + HITL/checkpoint harness |
| [`@theokit/agents`](https://www.npmjs.com/package/@theokit/agents) | ![npm](https://img.shields.io/npm/v/@theokit/agents?style=flat-square&label=) | `AgentBuilder`, the SDK adapter, guardrails, skills, MCP, A2A/ACP, delegation |
| [`@theokit/agents-pty`](https://www.npmjs.com/package/@theokit/agents-pty) | ![npm](https://img.shields.io/npm/v/@theokit/agents-pty?style=flat-square&label=) | The PTY/terminal backend, split out by ADR 0004 so a web app stops compiling one. **Install it only if you drive a terminal** — `@theokit/agents` no longer pulls it in |
| [`@theokit/http`](https://www.npmjs.com/package/@theokit/http) | ![npm](https://img.shields.io/npm/v/@theokit/http?style=flat-square&label=) | NestJS-style HTTP decorators + pipeline + typed client |
| [`@theokit/presenter`](https://www.npmjs.com/package/@theokit/presenter) | ![npm](https://img.shields.io/npm/v/@theokit/presenter?style=flat-square&label=) | The canonical `AgentOutputEvent` + presenters for web / terminal / JSON |
| [`@theokit/tauri`](https://www.npmjs.com/package/@theokit/tauri) | ![npm](https://img.shields.io/npm/v/@theokit/tauri?style=flat-square&label=) | Desktop glue — the Channel/invoke transport + the JSONL sidecar |
| [`create-theokit`](https://www.npmjs.com/package/create-theokit) | ![npm](https://img.shields.io/npm/v/create-theokit?style=flat-square&label=) | Project scaffolding CLI (`--surface=web\|tui\|desktop`, `--bare`) |

### Sibling repos

Published independently; install what you need.

| Family | Packages |
|---|---|
| **Agent runtime** | `@theokit/sdk` — the only agent runtime — plus `sdk-tools`, `sdk-budget`, `sdk-cache`, `sdk-memory`, `sdk-handoff` |
| **UI** | `@theokit/ui` (chat + agent surfaces), `@usetheo/ui` (generic primitives) |
| **Auth providers** | `@theokit/auth-github`, `@theokit/auth-google`, `@theokit/auth-magic-link` |
| **Plugins** | `@theokit/plugin-canvas`, `-copilot`, `-db-drizzle`, `-email`, `-forms`, `-payments`, `-realtime`, `-voice` |
| **Gateways** | `@theokit/gateway-sms`, `-line`, `-matrix`, `-mattermost` |

`@theokit/codemod-sdk-2-0` is **deprecated and archived** — it targeted an
abandoned rename that never shipped. Do not use it.

## Ecosystem

TheoKit sits inside the [Theo](https://usetheo.dev) product family. It is
**self-contained** — it builds, ships, and runs without any sibling project.

| Sibling | Direction | How it relates |
|---------|-----------|----------------|
| **`@theokit/sdk`** — agent runtime | TheoKit ← sibling | The **only** agent runtime. `Agent.create()`, `Run`, `Tool.create()`, `Skill.create()`, providers, persistence. Consumed from npm, not workspace-linked. |
| **`@theokit/ui`** — AI-native React components | TheoKit ← sibling | The chat and agent surfaces, on the Violet Forge design system. Detected at build time: when it and `@tailwindcss/vite` are installed, the framework wires Tailwind v4 and the UI plugin for you. Generic primitives live in `@usetheo/ui`. |
| **`@theokit/auth-*`**, **`@theokit/gateway-*`** | TheoKit ← sibling | OAuth/magic-link providers and messaging channels, each an independent package. |
| **`@theokit/plugin-*`** | TheoKit → sibling | Eight plugins. Apps install them explicitly. |
| **TheoCloud** — managed platform | TheoKit → sibling | **Principal deploy target.** TheoKit ships a thin validator adapter; K8s emission lives inside TheoCloud. |

## Status

Beta. The framework is used to build real apps, and the surface still moves between
minor versions — breaking changes are recorded in [`CHANGELOG.md`](CHANGELOG.md)
against the version that carried them.

- **7232 tests in 930 files** (7211 passing, 21 skipped, zero type errors) — unit, integration and type-level suites across `theokit`, `@theokit/http`, `@theokit/agents`, `@theokit/agents-pty`, `@theokit/presenter` and `create-theokit`. One command: `pnpm test`. Measured 2026-08-26; a number nobody re-measures is a claim, not a fact.
- **Nine CI jobs gate every PR**: lint + format, typecheck + build, unit + type tests, a coverage floor of 80%, dead code (`knip`), package validation (`publint` + `attw` + an install smoke test), a production dependency audit, and license compliance. Alongside them run the architecture guards — `dependency-cruiser` rules, `ls-lint` filename conventions, SDK surface parity — plus CodeQL and a two-layer secret scan (pre-commit hook and workflow).
- **Nine deploy targets**, with TheoCloud as the principal one.
- **There is no browser/E2E harness.** A change to rendering or hydration needs a reviewer to exercise it by hand.
- The **`wiki/`** that held the internal decision trail was removed from the tree; the CHANGELOG is the public record, and the documents remain in git history.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the local gate (`pnpm test`, `pnpm typecheck`,
`pnpm lint`, `pnpm knip`), the TDD cycle, and the changelog rules. Security reports go
through [SECURITY.md](SECURITY.md); upgrading an app across versions is documented in
[MIGRATION.md](MIGRATION.md) and the CHANGELOG.

## License

Apache-2.0 — see [LICENSE](LICENSE).

## Community

- Discord: https://discord.usetheo.dev/
- X: https://x.com/usetheodev
- LinkedIn: https://linkedin.com/company/usetheodev
