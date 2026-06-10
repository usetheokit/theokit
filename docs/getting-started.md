# Getting Started — TheoKit

Build a full-stack AI app in 5 minutes. **Zero wiring.** Write your controllers, agents, and tools — TheoKit does the rest.

## Quick Start

```bash
mkdir my-app && cd my-app
npm init -y
npm install theokit @theokit/http-decorators @theokit/agents reflect-metadata zod
```

## The App

**One file. Controllers, agents, tools, auth — all wired automatically.**

```typescript
// app.ts
import 'reflect-metadata'
import { z } from 'zod'
import {
  Controller, Get, Post, Delete,
  Body, Param, HttpCode,
  UseGuards, NotFoundException,
  createDecorator, Reflector,
  type CanActivate, type ExecutionContext,
} from '@theokit/http-decorators'
import { TheoApp } from '@theokit/http-decorators/app'
import {
  Agent, MainLoop, Toolbox, Tool, Mixin,
  Memory, Budget, Trace,
} from '@theokit/agents'

// ─── Auth ───────────────────────────────────────────

enum Role { User = 'user', Admin = 'admin' }
const Roles = createDecorator<Role[]>()
const IsPublic = createDecorator<boolean>()
const reflector = new Reflector()

class RolesGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    if (reflector.getAllAndOverride(IsPublic, ctx.getClass(), ctx.getMethodName())) return true
    const roles = reflector.getAllAndOverride(Roles, ctx.getClass(), ctx.getMethodName())
    if (!roles) return true
    return roles.includes(ctx.getRequest().headers.get('x-role') as Role)
  }
}

// ─── Controller ─────────────────────────────────────

const tasks = [
  { id: 1, title: 'Learn TheoKit', done: false },
  { id: 2, title: 'Build AI agent', done: false },
]

@Controller('api/tasks')
@UseGuards(RolesGuard)
@Roles([Role.User])
class TasksController {
  @Get()
  @IsPublic(true)
  list() { return tasks }

  @Post()
  create(@Body(z.object({ title: z.string().min(3) })) body: { title: string }) {
    const task = { id: tasks.length + 1, title: body.title, done: false }
    tasks.push(task)
    return task
  }

  @Delete(':id')
  @Roles([Role.Admin])
  @HttpCode(204)
  remove(@Param('id') id: string) {
    const idx = tasks.findIndex(t => t.id === Number(id))
    if (idx === -1) throw new NotFoundException(`Task ${id} not found`)
    tasks.splice(idx, 1)
  }
}

// ─── Agent Tools ────────────────────────────────────

@Toolbox({ namespace: 'tasks' })
@Trace(true)
class TaskTools {
  @Tool({ name: 'list', description: 'List all tasks', input: z.object({}) })
  async list() { return JSON.stringify(tasks) }

  @Tool({ name: 'create', description: 'Create a task', input: z.object({ title: z.string() }) })
  async create(input: { title: string }) {
    const task = { id: tasks.length + 1, title: input.title, done: false }
    tasks.push(task)
    return JSON.stringify(task)
  }

  @Tool({ name: 'complete', description: 'Mark task done', input: z.object({ taskId: z.number() }) })
  async complete(input: { taskId: number }) {
    const task = tasks.find(t => t.id === input.taskId)
    if (!task) return 'Not found'
    task.done = true
    return JSON.stringify(task)
  }
}

// ─── AI Agent ───────────────────────────────────────

@Agent({
  name: 'assistant',
  route: '/api/agents/assistant',
  model: 'openai/gpt-4o-mini',
  systemPrompt: 'You help manage tasks. Use tools to list, create, and complete tasks.',
})
@UseGuards(RolesGuard)
@Roles([Role.User])
@Memory({ provider: 'built-in', scope: 'per-user' })
@Budget({ maxCostUsd: 1.00 })
@Mixin(TaskTools)
class AssistantAgent {
  @MainLoop({ strategy: 'react', maxIterations: 5 })
  async run() {}
}

// ─── Start (that's it — zero wiring) ────────────────

const app = await TheoApp.create({
  controllers: [TasksController],
  agents: [AssistantAgent],
  providers: [TaskTools],
})

await app.listen(3000)
```

## Run

```bash
export OPENROUTER_API_KEY=sk-or-v1-YOUR_KEY_HERE
bun app.ts
```

## Test

```bash
# CRUD
curl http://localhost:3000/api/tasks
curl -X POST http://localhost:3000/api/tasks -H "x-role: user" -H "Content-Type: application/json" -d '{"title":"Ship it"}'

# AI Agent (real LLM + tool calling + SSE streaming)
curl -N -X POST http://localhost:3000/api/agents/assistant/chat \
  -H "x-role: user" -H "Content-Type: application/json" \
  -d '{"message":"List all tasks and mark the first one as done"}'
```

## What `TheoApp.create()` Does For You

You write **declarations**. The framework does **everything else**.

```
TheoApp.create({ controllers, agents, providers })
  │
  ├── 1. Registers providers (DI)
  │
  ├── 2. Walks @Controller metadata
  │     └── Mounts HTTP routes
  │
  ├── 3. Walks @Agent metadata
  │     ├── Discovers @Mixin toolboxes
  │     ├── Resolves toolbox instances from DI
  │     ├── Compiles @Tool → LLM tool definitions
  │     ├── Connects to LLM API
  │     └── Mounts SSE endpoint at {route}/chat
  │
  ├── 4. Applies shared pipeline
  │     ├── Guards — same for HTTP and AI
  │     ├── Interceptors
  │     ├── Filters
  │     └── Throttle
  │
  └── 5. Starts server (Node/Bun/Deno)
```

**You never call** `walkAgentMetadata`, `compileAgent`, `generateAgentRoutes`, or any internal API.

## The Pipeline

Controllers and agents share the **exact same pipeline**:

```
Request → Middleware → Guards → Interceptors → Handler → Filters → Response
```

Write a guard once. Use it everywhere.

```typescript
@UseGuards(RolesGuard)  // on a controller — works
@UseGuards(RolesGuard)  // on an agent — same guard, same behavior
```

## Performance

| Runtime | Req/s | Command |
|---|---|---|
| **Bun** | 4,587 | `bun app.ts` |
| **Deno** | 4,392 | `deno run -A app.ts` |
| Node | 1,502 | `npx tsx app.ts` |
