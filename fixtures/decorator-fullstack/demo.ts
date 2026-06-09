import 'reflect-metadata'
import { z } from 'zod'
import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  UseGuards,
  UseInterceptors,
} from '../../packages/http-decorators/src/index.js'
import { createDecoratorServer } from '../../packages/http-decorators/src/bridge/create-server.js'
import type { Interceptor } from '../../packages/http-decorators/src/bridge/interceptor-chain.js'
import type { NestMiddleware } from '../../packages/http-decorators/src/bridge/middleware-consumer.js'
import type { IncomingMessage, ServerResponse } from 'node:http'

// ─── Interceptors ───

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

// ─── Middleware ───

class LoggerMiddleware implements NestMiddleware {
  use(req: IncomingMessage, _res: ServerResponse, next: () => void) {
    console.log(`  [MW] ${req.method} ${req.url}`)
    next()
  }
}

function corsMiddleware(_req: IncomingMessage, res: ServerResponse, next: () => void) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('X-Powered-By', 'TheoKit Decorators')
  next()
}

// ─── Guards ───

class AuthGuard {
  canActivate(req: IncomingMessage) {
    return req.headers.authorization === 'Bearer theokit-token'
  }
}

// ─── In-memory store ───

const tasks = [
  { id: 1, title: 'Setup TheoKit', done: true, priority: 'high' },
  { id: 2, title: 'Implement interceptors', done: true, priority: 'high' },
  { id: 3, title: 'Add NestJS middleware', done: true, priority: 'medium' },
  { id: 4, title: 'Write documentation', done: false, priority: 'low' },
]
let nextId = 5

const zCreateTask = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters'),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
})

// ─── Controller ───

@UseInterceptors(TimingInterceptor)
@Controller('api/tasks')
class TasksController {
  @Get()
  findAll() {
    return tasks
  }

  @Get('stats')
  stats() {
    return {
      total: tasks.length,
      done: tasks.filter((t) => t.done).length,
      pending: tasks.filter((t) => !t.done).length,
    }
  }

  @Get('search')
  search(@Query('q') q: string) {
    return tasks.filter((t) => t.title.toLowerCase().includes((q ?? '').toLowerCase()))
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return tasks.find((t) => t.id === Number(id)) ?? { error: 'Task not found' }
  }

  @Post()
  @UseInterceptors(ResponseWrapInterceptor)
  create(@Body(zCreateTask) body: z.infer<typeof zCreateTask>) {
    const task = { id: nextId++, ...body, done: false }
    tasks.push(task)
    return task
  }

  @Post(':id/complete')
  complete(@Param('id') id: string) {
    const task = tasks.find((t) => t.id === Number(id))
    if (task) task.done = true
    return task ?? { error: 'Task not found' }
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    const idx = tasks.findIndex((t) => t.id === Number(id))
    if (idx >= 0) tasks.splice(idx, 1)
  }

  @Get('admin/dashboard')
  @UseGuards(AuthGuard)
  adminDashboard() {
    return { admin: true, taskCount: tasks.length, secret: 'only-for-admins' }
  }
}

// ─── Start server ───

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
╔══════════════════════════════════════════════════════════╗
║  TheoKit HTTP Decorators — Live Demo                    ║
║  NestJS-style: Middleware → Guards → Interceptors       ║
╠══════════════════════════════════════════════════════════╣
║                                                         ║
║  Server: http://localhost:${PORT}                          ║
║                                                         ║
║  Endpoints:                                             ║
║                                                         ║
║  GET  /api/tasks              — list all tasks          ║
║  GET  /api/tasks/stats        — statistics              ║
║  GET  /api/tasks/search?q=kit — search                  ║
║  GET  /api/tasks/1            — get by id               ║
║  POST /api/tasks              — create (Zod validated)  ║
║  POST /api/tasks/1/complete   — mark done               ║
║  DEL  /api/tasks/4            — delete                  ║
║  GET  /api/tasks/admin/dashboard — requires auth        ║
║                                                         ║
║  Features:                                              ║
║    ✓ @Controller + @Get/@Post/@Delete decorators        ║
║    ✓ @Body(zodSchema) — Zod validation (422 on fail)   ║
║    ✓ @Param('id') + @Query('q') param decorators       ║
║    ✓ @UseInterceptors(TimingInterceptor) — headers     ║
║    ✓ @UseInterceptors(ResponseWrapInterceptor) — POST  ║
║    ✓ @UseGuards(AuthGuard) — Bearer token auth         ║
║    ✓ LoggerMiddleware — NestJS class middleware         ║
║    ✓ corsMiddleware — functional middleware             ║
║    ✓ configure().forRoutes() — route filtering         ║
║                                                         ║
║  curl examples:                                         ║
║                                                         ║
║  curl localhost:4000/api/tasks                          ║
║  curl -X POST localhost:4000/api/tasks \\                ║
║    -H "Content-Type: application/json" \\                ║
║    -d '{"title":"New task","priority":"high"}'          ║
║  curl localhost:4000/api/tasks/admin/dashboard \\        ║
║    -H "Authorization: Bearer theokit-token"            ║
║                                                         ║
╚══════════════════════════════════════════════════════════╝
`)
})
