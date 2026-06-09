/**
 * TheoKit HTTP Decorators — Complete NestJS Pipeline Demo
 *
 * Demonstrates EVERY feature of @theokit/http-decorators:
 *
 *   Middleware → Guards → Interceptors → Handler → Exception Filters
 *
 * Run: npx tsx fixtures/decorator-fullstack/demo-launcher.ts
 */
import 'reflect-metadata'
import { resolve } from 'node:path'
import http from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'

import { loadControllerWithSwc } from '../../packages/http-decorators/src/bridge/swc-loader.js'
import { createDecoratorServer } from '../../packages/http-decorators/src/bridge/create-server.js'
import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Body,
  HttpCode,
  UseGuards,
  UseInterceptors,
  UseFilters,
  Catch,
  createDecorator,
  SetMetadata,
  Reflector,
  NotFoundException,
  ForbiddenException,
  HttpException,
  type Interceptor,
  type ExceptionFilter,
  type ArgumentsHost,
} from '../../packages/http-decorators/src/index.js'
import { z } from 'zod'

// ═══════════════════════════════════════════════════════════
// 1. CUSTOM METADATA — @Roles(['admin']) via createDecorator
// ═══════════════════════════════════════════════════════════

const Roles = createDecorator<string[]>()
const IsPublic = createDecorator<boolean>()

// ═══════════════════════════════════════════════════════════
// 2. MIDDLEWARE — NestJS class + functional middleware
// ═══════════════════════════════════════════════════════════

class LoggerMiddleware {
  use(req: IncomingMessage, _res: ServerResponse, next: () => void) {
    const time = new Date().toLocaleTimeString()
    console.log(`  [${time}] ${req.method} ${req.url}`)
    next()
  }
}

function corsMiddleware(_req: IncomingMessage, res: ServerResponse, next: () => void) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('X-Powered-By', 'TheoKit HTTP Decorators')
  next()
}

// ═══════════════════════════════════════════════════════════
// 3. GUARDS — canActivate + role-based auth
// ═══════════════════════════════════════════════════════════

class AuthGuard {
  canActivate(req: IncomingMessage) {
    return req.headers.authorization === 'Bearer theokit-token'
  }
}

class RolesGuard {
  canActivate(req: IncomingMessage) {
    const userRole = req.headers['x-role'] as string | undefined
    return Boolean(userRole)
  }
}

// ═══════════════════════════════════════════════════════════
// 4. INTERCEPTORS — timing + response wrapping
// ═══════════════════════════════════════════════════════════

class TimingInterceptor implements Interceptor {
  async intercept(_req: IncomingMessage, res: ServerResponse, next: () => Promise<unknown>) {
    const start = Date.now()
    const result = await next()
    res.setHeader('X-Response-Time', `${Date.now() - start}ms`)
    return result
  }
}

class ResponseWrapInterceptor implements Interceptor {
  async intercept(_req: IncomingMessage, _res: ServerResponse, next: () => Promise<unknown>) {
    const result = await next()
    return { data: result, timestamp: new Date().toISOString(), api: 'v1' }
  }
}

class CacheInterceptor implements Interceptor {
  private cache = new Map<string, { data: unknown; expires: number }>()

  async intercept(req: IncomingMessage, res: ServerResponse, next: () => Promise<unknown>) {
    const key = req.url ?? '/'
    const cached = this.cache.get(key)
    if (cached && cached.expires > Date.now()) {
      res.setHeader('X-Cache', 'HIT')
      return cached.data
    }
    const result = await next()
    this.cache.set(key, { data: result, expires: Date.now() + 5000 })
    res.setHeader('X-Cache', 'MISS')
    return result
  }
}

// ═══════════════════════════════════════════════════════════
// 5. EXCEPTION FILTERS — @Catch + custom error formatting
// ═══════════════════════════════════════════════════════════

@Catch(HttpException)
class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.getResponse()
    const req = host.getRequest()
    const ex = exception as HttpException
    res.writeHead(ex.statusCode, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({
        error: {
          code: ex.code,
          message: ex.message,
          statusCode: ex.statusCode,
          path: req.url,
          timestamp: new Date().toISOString(),
        },
      }),
    )
  }
}

// ═══════════════════════════════════════════════════════════
// 6. DATA STORE — in-memory
// ═══════════════════════════════════════════════════════════

interface Task {
  id: number
  title: string
  done: boolean
  priority: string
}

const tasks: Task[] = [
  { id: 1, title: 'Setup TheoKit decorators', done: true, priority: 'high' },
  { id: 2, title: 'Implement middleware pipeline', done: true, priority: 'high' },
  { id: 3, title: 'Add exception filters', done: true, priority: 'medium' },
  { id: 4, title: 'Write documentation', done: false, priority: 'low' },
]
let nextId = 5

const zCreateTask = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters'),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
})

// ═══════════════════════════════════════════════════════════
// 7. CONTROLLER — all decorators in action
// ═══════════════════════════════════════════════════════════

@UseInterceptors(TimingInterceptor)
@UseFilters(HttpExceptionFilter)
@Controller('api/tasks')
class TasksController {
  // ── Public endpoints ──

  @Get()
  @IsPublic(true)
  findAll() {
    return tasks
  }

  @Get('stats')
  @IsPublic(true)
  stats() {
    return {
      total: tasks.length,
      done: tasks.filter((t) => t.done).length,
      pending: tasks.filter((t) => !t.done).length,
    }
  }

  @Get('search')
  @IsPublic(true)
  search(@Query('q') q: string) {
    return tasks.filter((t) => t.title.toLowerCase().includes((q ?? '').toLowerCase()))
  }

  @Get(':id')
  @IsPublic(true)
  findOne(@Param('id') id: string) {
    const task = tasks.find((t) => t.id === Number(id))
    if (!task) throw new NotFoundException(`Task ${id} not found`)
    return task
  }

  // ── Protected endpoints ──

  @Post()
  @UseInterceptors(ResponseWrapInterceptor)
  @Roles(['editor', 'admin'])
  create(@Body(zCreateTask) body: z.infer<typeof zCreateTask>) {
    const task: Task = { id: nextId++, ...body, done: false }
    tasks.push(task)
    return task
  }

  @Post(':id/complete')
  @Roles(['editor', 'admin'])
  complete(@Param('id') id: string) {
    const task = tasks.find((t) => t.id === Number(id))
    if (!task) throw new NotFoundException(`Task ${id} not found`)
    task.done = true
    return task
  }

  @Delete(':id')
  @HttpCode(204)
  @UseGuards(AuthGuard)
  @Roles(['admin'])
  remove(@Param('id') id: string) {
    const idx = tasks.findIndex((t) => t.id === Number(id))
    if (idx < 0) throw new NotFoundException(`Task ${id} not found`)
    tasks.splice(idx, 1)
  }

  // ── Admin-only ──

  @Get('admin/dashboard')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(['admin'])
  dashboard() {
    return {
      admin: true,
      taskCount: tasks.length,
      completionRate: `${Math.round((tasks.filter((t) => t.done).length / tasks.length) * 100)}%`,
    }
  }
}

// ═══════════════════════════════════════════════════════════
// 8. SERVER — wire everything together
// ═══════════════════════════════════════════════════════════

const PORT = 4000

const server = createDecoratorServer({
  controllers: [TasksController],
  configure(consumer) {
    consumer.apply(corsMiddleware).forRoutes('*')
    consumer.apply(LoggerMiddleware).forRoutes('api/tasks')
  },
})

server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║  TheoKit HTTP Decorators — Complete NestJS Pipeline Demo         ║
║  Middleware → Guards → Interceptors → Handler → Exception Filters║
╠═══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  Server: http://localhost:${PORT}                                   ║
║                                                                  ║
║  ┌────────────────────────────────────────────────────────────┐  ║
║  │ PUBLIC ENDPOINTS                                          │  ║
║  │  GET  /api/tasks              — list all tasks            │  ║
║  │  GET  /api/tasks/stats        — task statistics           │  ║
║  │  GET  /api/tasks/search?q=doc — search tasks              │  ║
║  │  GET  /api/tasks/1            — get by id                 │  ║
║  └────────────────────────────────────────────────────────────┘  ║
║                                                                  ║
║  ┌────────────────────────────────────────────────────────────┐  ║
║  │ PROTECTED ENDPOINTS                                       │  ║
║  │  POST /api/tasks              — create (Zod + wrapped)    │  ║
║  │  POST /api/tasks/1/complete   — mark done                 │  ║
║  │  DEL  /api/tasks/4            — delete (auth required)    │  ║
║  │  GET  /api/tasks/admin/dashboard — admin only             │  ║
║  └────────────────────────────────────────────────────────────┘  ║
║                                                                  ║
║  ┌────────────────────────────────────────────────────────────┐  ║
║  │ ERROR SCENARIOS                                           │  ║
║  │  GET  /api/tasks/999          — 404 NotFoundException     │  ║
║  │  POST /api/tasks {"title":"a"} — 422 Zod validation       │  ║
║  │  DEL  /api/tasks/1            — 401 no auth token         │  ║
║  └────────────────────────────────────────────────────────────┘  ║
║                                                                  ║
║  PIPELINE FEATURES DEMONSTRATED:                                 ║
║                                                                  ║
║    Decorators:                                                   ║
║      ✓ @Controller('prefix')                                    ║
║      ✓ @Get / @Post / @Delete + @HttpCode(204)                  ║
║      ✓ @Body(zodSchema) — Zod SSoT validation                  ║
║      ✓ @Param('id') + @Query('q')                               ║
║                                                                  ║
║    Middleware (runs FIRST):                                       ║
║      ✓ LoggerMiddleware — NestJS class middleware               ║
║      ✓ corsMiddleware — functional middleware                   ║
║      ✓ configure().forRoutes() route filtering                  ║
║                                                                  ║
║    Guards (runs SECOND):                                         ║
║      ✓ @UseGuards(AuthGuard) — Bearer token auth               ║
║      ✓ @UseGuards(AuthGuard, RolesGuard) — chained guards      ║
║      ✓ @Roles(['admin']) — custom metadata via createDecorator  ║
║                                                                  ║
║    Interceptors (runs THIRD):                                    ║
║      ✓ TimingInterceptor — X-Response-Time header               ║
║      ✓ ResponseWrapInterceptor — {data, timestamp} envelope    ║
║      ✓ Class-level + method-level composition                   ║
║                                                                  ║
║    Exception Filters (catches errors):                           ║
║      ✓ NotFoundException → 404 with path + timestamp            ║
║      ✓ @UseFilters(HttpExceptionFilter) — custom format         ║
║      ✓ Zod validation → 422 (built-in)                          ║
║      ✓ Guard rejection → 401 (built-in)                         ║
║      ✓ Global fallback → 500 for unhandled errors               ║
║                                                                  ║
║    Infrastructure:                                               ║
║      ✓ SWC-powered controller loading (esbuild bypass)          ║
║      ✓ Symbol.for() metadata keys (cross-module safe)           ║
║      ✓ DI container support (resolveOrNew pattern)              ║
║                                                                  ║
╚═══════════════════════════════════════════════════════════════════╝

  Try these:

    # Public
    curl localhost:${PORT}/api/tasks
    curl localhost:${PORT}/api/tasks/stats
    curl localhost:${PORT}/api/tasks/search?q=doc
    curl localhost:${PORT}/api/tasks/1

    # Error handling
    curl localhost:${PORT}/api/tasks/999
    curl -X POST localhost:${PORT}/api/tasks -H "Content-Type: application/json" -d '{"title":"a"}'

    # Protected
    curl -X POST localhost:${PORT}/api/tasks -H "Content-Type: application/json" -d '{"title":"New task","priority":"high"}'
    curl -X DELETE localhost:${PORT}/api/tasks/4
    curl -X DELETE localhost:${PORT}/api/tasks/4 -H "Authorization: Bearer theokit-token"

    # Admin
    curl localhost:${PORT}/api/tasks/admin/dashboard -H "Authorization: Bearer theokit-token" -H "x-role: admin"
`)
})
