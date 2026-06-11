# AGENTS.md — TheoKit App

Guide for coding agents (Claude, Copilot, Cursor) working on this TheoKit project.

## Architecture

This is a **full-stack TypeScript app** built with TheoKit — a framework for AI agent apps.

```
app.ts              → Entry point: TheoApp.create({ controllers, agents, providers })
server/
  controllers/      → HTTP endpoints (@Controller + @Get/@Post/@Delete)
  agents/           → AI agents (@Agent + @MainLoop + @Tool)
  toolboxes/        → Agent tools (@Toolbox + @Tool with Zod schemas)
  guards/           → Auth/RBAC (@UseGuards + canActivate)
  interceptors/     → Request/response transforms (@UseInterceptors)
  filters/          → Error formatting (@UseFilters + @Catch)
  middleware/       → Request pipeline (NestMiddleware)
  store.ts          → In-memory data store
app/
  page.tsx          → React frontend
  layout.tsx        → Root layout
public/
  index.html        → Static HTML frontend with chat UI
```

## Key Patterns

### Controllers (HTTP API)
```typescript
import { Controller, Get, Post, Body, Param } from '@theokit/http'
import { z } from 'zod'

const zCreate = z.object({ title: z.string().min(3) })

@Controller('api/tasks')
class TasksController {
  @Get()
  list() { return tasks }

  @Post()
  create(@Body(zCreate) body: z.infer<typeof zCreate>) {
    return store.create(body)  // 201 automatic for POST
  }
}
```

### Agents (AI with tools)
```typescript
import { Agent, MainLoop, Toolbox, Tool, Mixin } from '@theokit/agents'

@Agent({ name: 'assistant', route: '/api/agents/assistant', model: 'openai/gpt-4o-mini' })
@Mixin(TaskTools)
class AssistantAgent {
  @MainLoop({ strategy: 'react' })
  async run() {}
}
```

### Validation
- **Zod is the single source of truth** — define schema once, get types + validation + OpenAPI
- `@Body(zodSchema)` validates automatically, returns 422 on failure
- Use `z.infer<typeof schema>` for TypeScript types

### Error Handling
- `throw new NotFoundException('...')` → 404
- `throw new BadRequestException('...')` → 400
- `@UseFilters(MyFilter)` for custom error format
- 500 errors are scrubbed — raw messages never reach clients

### Guards (Auth/RBAC)
- `@UseGuards(AuthGuard)` on controller or agent
- Guards apply to BOTH HTTP and agent routes (shared pipeline)
- `canActivate(ctx: ExecutionContext): boolean`

### Path Aliases
- `@/*` → project root (configured in tsconfig.json)
- `@/server/*` → `./server/*`

## Commands

```bash
npm run dev          # Start dev server (tsx --watch)
npm run build        # Build for production (tsup)
npm run start        # Run production build
npm run lint         # ESLint check
npm run format       # Prettier format
npm run typecheck    # TypeScript type check
```

## Don't

- Don't use `any` — use Zod schemas + `z.infer<>`
- Don't write raw `res.status().json()` — use decorators (`@HttpCode`, `@Header`)
- Don't create separate auth middleware for agents — use `@UseGuards` (same as controllers)
- Don't parse request body manually — use `@Body(zodSchema)`
