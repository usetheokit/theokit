# TheoKit

**Build the app your agent lives in.** Routing, auth, real-time, deploy — wired.

Part of the [Theo](https://usetheo.dev) family of products. TheoKit is the **web framework** layer — independent and self-contained, with **TheoCloud** as its principal deploy target. See [the Ecosystem section](#ecosystem) for how it relates to its siblings.

[![License](https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square)](./LICENSE)
[![Status](https://img.shields.io/badge/status-beta-yellow?style=flat-square)](#status)
[![Tests](https://img.shields.io/badge/tests-566%20passing-brightgreen?style=flat-square)](#)
[![npm](https://img.shields.io/npm/v/theokit?style=flat-square&label=theokit)](https://www.npmjs.com/package/theokit)
[![npm](https://img.shields.io/npm/v/@theokit/http?style=flat-square&label=@theokit/http)](https://www.npmjs.com/package/@theokit/http)
[![npm](https://img.shields.io/npm/v/@theokit/agents?style=flat-square&label=@theokit/agents)](https://www.npmjs.com/package/@theokit/agents)

## Quick Start

```bash
npx create-theokit my-app
cd my-app
pnpm dev
```

## Your first agent in 5 minutes

1. Point TheoKit at an Anthropic model — set your key:

   ```bash
   export ANTHROPIC_API_KEY=sk-ant-...
   ```

2. Create an agent and send it a message. The canonical 6-line essence uses
   `throwOnError: true` so failures surface as exceptions you handle with
   `try`/`catch` — no status-code checking:

   ```ts
   import { Agent } from '@theokit/sdk'

   const agent = await Agent.create({ model: 'claude-sonnet-4-6' })

   try {
     const result = await agent.send('Write a haiku about TypeScript.', { throwOnError: true })
     console.log(result.text)
   } catch (err) {
     console.error('agent failed:', err)
   }
   ```

That is the whole loop: create, send, read the text. Everything else —
streaming, tools, conversation history — is sugar over this.

## What You Get

- **Routes are just files** — `app/page.tsx` → `/`. Layouts, errors, loading, not-found — no config.
- **Route groups** — `app/(marketing)/pricing/page.tsx` → `/pricing`. Organize without affecting URLs.
- **APIs that validate themselves** — Zod schemas in, types out, end-to-end.
- **NestJS-style decorators** — `@Controller`, `@Get`, `@Post`, `@Body(Zod)`, `@UseGuards`, `@UseInterceptors`, `@UseFilters` for structured HTTP pipelines.
- **AI agents as first-class citizens** — `@Agent`, `@Tool`, `@Toolbox`, `@MainLoop` with SSE streaming, budget control, human-in-the-loop approval.
- **Convention over configuration** — `@Controller()` on `UsersController` infers `api/users`. `@Agent()` on `SupportAgent` infers name + route. Zero boilerplate.
- **Shared guards between HTTP and AI** — same `@UseGuards(AuthGuard)` protects controllers and agents. Same RBAC, one model.
- **Server actions without plumbing** — CSRF, validation, serialization handled.
- **Backend calls that compile** — import the route type, get request and response inferred.
- **Sessions that just work** — encrypted cookies, one helper to require a logged-in user.
- **WebSocket as a file** — drop a file in `server/ws/`, it's a real-time endpoint.
- **SDK is the only agent runtime** — `@theokit/sdk` handles LLM calls, tool execution, conversation persistence. No reimplemented runners.
- **Ship to TheoCloud** — managed runtime with hosted Postgres, Redis, secret rotation, audit log.
- **62 HTTP status codes** — `HttpStatus.OK`, `HttpStatus.TOO_MANY_REQUESTS`, etc.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        User Application                             │
│  app/           Frontend — file-based routing + route groups        │
│  server/        Backend — controllers, agents, toolboxes, routes    │
└─────────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌──────────────┐    ┌──────────────────┐    ┌──────────────┐
│  theokit     │    │  @theokit/http   │    │@theokit/agents│
│  Framework   │    │  HTTP Pipeline   │    │  AI Pipeline  │
│  core/config │    │  16 decorators   │    │  15 decorators│
│  router/cli  │    │  329 tests       │    │  237 tests    │
└──────────────┘    └──────────────────┘    └──────────────┘
                              │                     │
                         Guards shared          @theokit/sdk
                         (same @UseGuards)      Agent.create()
                                                Run.stream()
```

**Key design decisions:**
- HTTP and AI share **guards/policies**, but run through **distinct execution pipelines** (not the same middleware chain).
- `@UseInterceptors` and `@UseFilters` on agents emit explicit warnings — they are metadata-only in this version. Guards are the shared surface.
- `@Budget` on top-level agents is metadata-only; enforcement is active in `delegate()` sub-agent calls via clamping + mid-stream abort.
- `@Tool()` always requires explicit `name`, `description`, and `input` schema — no implicit tool exposure.

## HTTP Decorators (`@theokit/http`)

NestJS-compatible decorator system with Web Standards (Request/Response, not node:http).

### Controllers

```typescript
import { Controller, Get, Post, Body, Param, UseGuards, HttpStatus } from '@theokit/http'
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

```typescript
// Guards — decide if the request enters
class AuthGuard {
  canActivate(ctx: ExecutionContext): boolean {
    return ctx.getRequest().headers.get('authorization') !== null
  }
}

// Interceptors — wrap the handler
class TimingInterceptor {
  async intercept(ctx, next) {
    const start = Date.now()
    const result = await next()
    ctx.getResponse().headers.set('X-Response-Time', `${Date.now() - start}ms`)
    return result
  }
}

// Exception Filters — transform errors into responses
class HttpErrorFilter {
  catch(error, ctx) {
    return new Response(JSON.stringify({ error: error.message }), { status: error.status ?? 500 })
  }
}
```

### Available Decorators (16)

| Category | Decorators |
|---|---|
| **Routing** | `@Controller`, `@Get`, `@Post`, `@Put`, `@Delete`, `@Patch` |
| **Parameters** | `@Body`, `@Param`, `@Query`, `@Headers` |
| **Response** | `@HttpCode` |
| **Pipeline** | `@UseGuards`, `@UseInterceptors`, `@UseFilters` |
| **Policies** | `@Roles`, `@Throttle` |

## AI Agents (`@theokit/agents`)

Decorator-based agent definitions that compile to `@theokit/sdk` runtime.

### Agent + Toolbox

```typescript
import { Agent, MainLoop, Tool, Toolbox } from '@theokit/agents'
import { UseGuards } from '@theokit/http'
import { z } from 'zod'

// Convention: @Agent() on SupportAgent → name "support", route "/api/agents/support"
@Agent()
@UseGuards(AuthGuard)
class SupportAgent {
  @MainLoop({ strategy: 'react', maxIterations: 8 })
  async run() {}
}

// Convention: @Toolbox() on TicketTools → namespace "ticket"
@Toolbox()
class TicketTools {
  @Tool({
    name: 'search_tickets',
    description: 'Search support tickets by keyword',
    input: z.object({ query: z.string(), status: z.enum(['open', 'closed']).optional() }),
  })
  async searchTickets(input: { query: string; status?: string }) {
    return JSON.stringify(await db.tickets.search(input.query, input.status))
  }

  @Tool({
    name: 'close_ticket',
    description: 'Close a ticket by ID',
    input: z.object({ ticketId: z.string() }),
    risk: 'medium',
  })
  @RequiresApproval({ reason: 'Closing a ticket affects customer workflow' })
  async closeTicket(input: { ticketId: string }) {
    await db.tickets.close(input.ticketId)
    return `Ticket ${input.ticketId} closed`
  }
}
```

### Available Decorators (15)

| Category | Decorators |
|---|---|
| **Definition** | `@Agent`, `@Tool`, `@Toolbox`, `@MainLoop` |
| **Model** | `@Model`, `@SubAgents`, `@Gateway` |
| **Policies** | `@Budget`, `@RequiresApproval` |
| **Lifecycle** | `@Memory`, `@Checkpoint`, `@Hook` |
| **Security** | `@Sandbox` (path traversal, command injection, null byte rejection) |
| **Observability** | `@Trace`, `@Audit` |

### Agent Stream Events (14 types)

```
run_started → text_delta → tool_call → tool_result → thinking →
iteration → approval_required → artifact_start → artifact_chunk →
state_update → checkpoint_saved → file_edit → error → done
```

### Multi-Agent Orchestration

```typescript
import { delegate } from '@theokit/agents/bridge'

const result = await delegate(ResearchAgent, 'Find papers on RAG', {
  apiKey: process.env.API_KEY,
  budget: 0.50,                    // USD cap
  parentBudgetRemaining: 1.00,     // Clamped to min(budget, parent)
  parentTools: compiledTools,       // Inherited tools
})
// result: { response, toolCalls, cost, tokens }
```

Budget enforcement: clamping at delegation + mid-stream abort on exceed.

## Decorator Support Matrix (Agents)

| Decorator | Agent support | Notes |
|---|---|---|
| `@UseGuards` | **enforced** | Same as HTTP — shared execution |
| `@UseInterceptors` | metadata-only | Warning `THEO_AGENT_INTERCEPTOR_METADATA_ONLY` |
| `@UseFilters` | metadata-only | Warning `THEO_AGENT_FILTER_METADATA_ONLY` |
| `@Budget` (top-level) | metadata-only | Warning `THEO_AGENT_BUDGET_TOP_LEVEL_METADATA_ONLY` |
| `@Budget` (delegate) | **enforced** | Clamping + mid-stream abort |
| `@RequiresApproval` | **enforced** | Human-in-the-loop |

## Convention Naming

Rails-style inference from class names — zero boilerplate for common patterns.

```typescript
@Controller()
class UsersController {}        // → prefix: "api/users"
class UserOrdersController {}   // → prefix: "api/user-orders"

@Agent()
class SupportAgent {}           // → name: "support", route: "/api/agents/support"
class CodeReviewAgent {}        // → name: "code-review", route: "/api/agents/code-review"

@Toolbox()
class ProjectTools {}           // → namespace: "project"
class BillingTools {}           // → namespace: "billing"
```

**Explicit always overrides inferred.** Pass arguments to any decorator to override.

**Safety rule:** Convention naming applies to routing (HTTP) and namespace (toolbox) — never to tool capabilities. `@Tool()` always requires explicit `name`, `description`, and `input` schema.

---

## How it works

The rest of this README is the technical surface. Vocabulary shifts here on purpose — `defineRoute`, `defineWebSocket`, `theoFetch`, and friends earn their keep below.

## Project Structure

```
my-app/
├── app/                       # Pages — file-based routing
│   ├── page.tsx               # /
│   ├── layout.tsx             # Root layout
│   ├── (marketing)/           # Route group (not in URL)
│   │   └── pricing/page.tsx   # /pricing
│   └── dashboard/
│       └── page.tsx           # /dashboard
├── server/                    # Backend — explicit and typed
│   ├── controllers/           # @Controller classes
│   ├── agents/                # @Agent classes
│   ├── toolboxes/             # @Toolbox classes
│   ├── guards/                # Shared guards
│   ├── interceptors/          # HTTP interceptors
│   ├── filters/               # Exception filters
│   ├── routes/                # API routes (defineRoute)
│   ├── actions/               # Server actions (defineAction)
│   ├── ws/                    # WebSocket endpoints
│   ├── middleware.ts           # Request middleware
│   ├── context.ts             # Request context factory
│   └── index.ts               # Single registration point
├── theo.config.ts              # Framework config
└── package.json
```

## Server Routes

```typescript
// server/routes/users.ts
import { defineRoute } from 'theokit/server'
import { z } from 'zod'

export const GET = defineRoute({
  query: z.object({ search: z.string().optional() }),
  handler: ({ query }) => {
    return { users: [{ name: 'Alice' }] }
  },
})

export const POST = defineRoute({
  body: z.object({ name: z.string(), email: z.string().email() }),
  status: 201,
  handler: ({ body }) => {
    return { id: crypto.randomUUID(), ...body }
  },
})
```

## Typed Client

```typescript
import { theoFetch } from 'theokit/client'
import type { GET } from '../../server/routes/users'

const data = await theoFetch<typeof GET>('/api/users', {
  query: { search: 'alice' }
})
// data is typed as { users: { name: string }[] }
```

## Auth

```typescript
import { createSessionManager, requireAuth } from 'theokit/server'

const auth = createSessionManager<{ userId: string }>({
  secret: process.env.SESSION_SECRET!, // min 32 chars
})

export const GET = defineRoute({
  handler: ({ ctx }) => {
    requireAuth(ctx.user) // throws 401 if null, narrows type
    return { userId: ctx.user.userId }
  },
})
```

## WebSocket

```typescript
// server/ws/chat.ts → ws://localhost:3000/ws/chat
import { defineWebSocket } from 'theokit/server'

export default defineWebSocket({
  onMessage(ws, data) {
    ws.send(`echo: ${data}`)
  },
})
```

## CLI

```bash
theokit dev                              # Dev server with HMR
theokit build                            # Production build
theokit start                            # Production server
theokit generate route users             # Scaffold API route
theokit generate controller products     # Scaffold @Controller
theokit generate agent support           # Scaffold @Agent
theokit generate toolbox billing         # Scaffold @Toolbox
theokit generate page dashboard          # Scaffold page
theokit generate action create-user      # Scaffold action
theokit generate ws notifications        # Scaffold WebSocket
theokit routes                           # List all endpoints
theokit docker                           # Generate Dockerfile
theokit check                            # Typecheck + scan
```

## Configuration

```typescript
// theo.config.ts
import { defineConfig } from 'theokit'

export default defineConfig({
  port: 3000,
  ssr: false,
  rateLimit: { windowMs: 60_000, max: 100 },
})
```

## Built With

| Layer | Technology |
|---|---|
| Bundler + Dev Server | Vite 6 |
| UI Framework | React 19 |
| Type Validation | Zod 4 |
| Build | tsup |
| Testing | Vitest + Playwright |
| Agent Runtime | @theokit/sdk |

## Packages

### TheoKit (this repo)

| Package | Version | Description |
|---|---|---|
| [`theokit`](https://www.npmjs.com/package/theokit) | 0.4.0 | Framework core — routing, server, CLI, config, adapters |
| [`@theokit/http`](https://www.npmjs.com/package/@theokit/http) | 0.5.0 | NestJS-style HTTP decorators + pipeline |
| [`@theokit/agents`](https://www.npmjs.com/package/@theokit/agents) | 0.4.0 | AI agent decorators + SDK adapter + orchestration |
| [`create-theokit`](https://www.npmjs.com/package/create-theokit) | 0.8.0 | Project scaffolding CLI |

### SDK (agent runtime — sibling repo)

| Package | Version | Description |
|---|---|---|
| [`@theokit/sdk`](https://www.npmjs.com/package/@theokit/sdk) | 1.7.0 | Agent runtime — `Agent.create()`, `Run.stream()`, providers, persistence |
| [`@theokit/sdk-tools`](https://www.npmjs.com/package/@theokit/sdk-tools) | 0.1.0 | Tool definition helpers for SDK agents |
| [`@theokit/sdk-budget`](https://www.npmjs.com/package/@theokit/sdk-budget) | 0.1.0 | Cost tracking + budget enforcement for agent runs |
| [`@theokit/sdk-cache`](https://www.npmjs.com/package/@theokit/sdk-cache) | 0.1.0 | Response caching layer for agent calls |
| [`@theokit/sdk-memory`](https://www.npmjs.com/package/@theokit/sdk-memory) | 0.1.0 | Persistent memory for agent conversations |
| [`@theokit/sdk-handoff`](https://www.npmjs.com/package/@theokit/sdk-handoff) | 0.1.0 | Agent-to-agent handoff protocol |
| [`@theokit/codemod-sdk-2-0`](https://www.npmjs.com/package/@theokit/codemod-sdk-2-0) | 1.0.0 | Codemod for SDK v1 → v2 migration |

### Auth providers (sibling repo)

| Package | Version | Description |
|---|---|---|
| [`@theokit/auth-github`](https://www.npmjs.com/package/@theokit/auth-github) | 0.1.0 | GitHub OAuth provider |
| [`@theokit/auth-google`](https://www.npmjs.com/package/@theokit/auth-google) | 0.1.0 | Google OAuth provider |
| [`@theokit/auth-magic-link`](https://www.npmjs.com/package/@theokit/auth-magic-link) | 0.1.0 | Passwordless magic link auth |

### Plugins (sibling repo)

| Package | Version | Description |
|---|---|---|
| [`@theokit/plugin-canvas`](https://www.npmjs.com/package/@theokit/plugin-canvas) | 0.3.0 | Canvas/whiteboard UI plugin |
| [`@theokit/plugin-copilot`](https://www.npmjs.com/package/@theokit/plugin-copilot) | 0.1.0 | In-app AI copilot assistant |
| [`@theokit/plugin-db-drizzle`](https://www.npmjs.com/package/@theokit/plugin-db-drizzle) | 0.1.0 | Drizzle ORM integration |
| [`@theokit/plugin-email`](https://www.npmjs.com/package/@theokit/plugin-email) | 0.1.0 | Transactional email (Resend/SendGrid) |
| [`@theokit/plugin-forms`](https://www.npmjs.com/package/@theokit/plugin-forms) | 0.1.2 | Form builder + validation |
| [`@theokit/plugin-payments`](https://www.npmjs.com/package/@theokit/plugin-payments) | 0.1.0 | Stripe payments integration |
| [`@theokit/plugin-realtime`](https://www.npmjs.com/package/@theokit/plugin-realtime) | 0.1.0 | Real-time subscriptions (WebSocket/SSE) |
| [`@theokit/plugin-voice`](https://www.npmjs.com/package/@theokit/plugin-voice) | 0.7.0 | Voice/audio agent interface |

### Gateways (messaging channels — sibling repo)

| Package | Version | Description |
|---|---|---|
| [`@theokit/gateway-sms`](https://www.npmjs.com/package/@theokit/gateway-sms) | 0.1.0 | SMS gateway (Twilio/Vonage) |
| [`@theokit/gateway-line`](https://www.npmjs.com/package/@theokit/gateway-line) | 0.1.0 | LINE messaging gateway |
| [`@theokit/gateway-matrix`](https://www.npmjs.com/package/@theokit/gateway-matrix) | 0.1.0 | Matrix protocol gateway |
| [`@theokit/gateway-mattermost`](https://www.npmjs.com/package/@theokit/gateway-mattermost) | 0.1.0 | Mattermost gateway |

## Ecosystem

TheoKit sits inside the [`Theo`](https://usetheo.dev) product family. It is **self-contained** — builds, ships, and runs without any sibling project. The ecosystem spans **27 published npm packages** across multiple repos.

| Sibling | Direction | How it relates | Status |
|---------|-----------|----------------|:------:|
| **`@theokit/sdk` v1.7.0** — agent runtime | TheoKit ← sibling | SDK is the **only** agent runtime (rule: INQUEBRAVEL). `Agent.create()`, `Run.stream()`, `defineTool()`. 6 sub-packages (tools, budget, cache, memory, handoff, codemod). | ✅ Wired |
| **`@theokit/auth-*`** — auth providers | TheoKit ← sibling | GitHub, Google OAuth + magic link. Each is an independent npm package. | ✅ Published |
| **`@theokit/plugin-*`** — 8 plugins | TheoKit → sibling | canvas, copilot, db-drizzle, email, forms, payments, realtime, voice. Apps install explicitly. | ✅ Published |
| **`@theokit/gateway-*`** — 4 gateways | TheoKit ← sibling | SMS, LINE, Matrix, Mattermost. Each is an independent npm package. | ✅ Published |
| **`@theokit/ui`** — React component library | TheoKit ← sibling | Chat surface, theme system. Auto-injected when detected. npm dep, not workspace link. | ✅ Wired |
| **TheoCloud** — managed platform | TheoKit → sibling | **Principal deploy target.** Thin validator adapter shipped. K8s emission lives in TheoCloud (Go). | ✅ Adapter shipped |

## Status

- **635+ tests passing** across 4 packages (319 HTTP + 239 agents + 71 create-theokit + 6 E2E). Zero lint errors, zero typecheck errors.
- **31 decorators** (16 HTTP + 15 agent) with convention naming inference.
- **14 agent stream event types** with discriminated union.
- **27 npm packages published** across the Theo ecosystem (4 core + 7 SDK + 3 auth + 8 plugins + 4 gateways + 1 codemod).
- **13 system design guardrails** enforced on every interaction (G1-G13 including YAGNI, DRY, Feature Creep).
- **Real E2E tests** — scaffold → install → dev server → HTTP request → 200 response.
- **SDK integration complete** — all agent execution flows through `@theokit/sdk` v1.7.0.
- **TheoCloud adapter shipped** — thin validator that bundles + uploads `services.json`.
- **Honest warnings** — `@UseInterceptors`, `@UseFilters`, `@Budget` on agents emit stable warning codes when enforcement is metadata-only.

## License

Apache-2.0 — see [LICENSE](LICENSE).

## Community

- Discord: https://discord.usetheo.dev/
- X: https://x.com/usetheodev
- LinkedIn: https://linkedin.com/company/usetheodev
