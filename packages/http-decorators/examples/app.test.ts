/**
 * ╔═══════════════════════════════════════════════════════════╗
 * ║       @theokit/http-decorators — Example App (TS)         ║
 * ╠═══════════════════════════════════════════════════════════╣
 * ║                                                           ║
 * ║  TypeScript REAL com @ syntax — NestJS-style full app     ║
 * ║  Controllers + Services + DI + Guards + Zod Validation    ║
 * ║                                                           ║
 * ║  Run: bash packages/http-decorators/examples/run-ts.sh    ║
 * ║                                                           ║
 * ╚═══════════════════════════════════════════════════════════╝
 */
import 'reflect-metadata'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { z } from 'zod'
import type { IncomingMessage } from 'node:http'
import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  Header,
  UseGuards,
  setMeta,
  ROUTE_PARAMS,
  createDecoratorServer,
  type DiContainer,
} from '../src/index.js'

// ╔═══════════════════════════════════════════════════════════╗
// ║  1. SERVICES — lógica de negócio injetável via DI         ║
// ╚═══════════════════════════════════════════════════════════╝

class TaskService {
  private tasks = [
    { id: 1, title: 'Learn TheoKit', done: false, priority: 'high' },
    { id: 2, title: 'Build an AI agent', done: false, priority: 'high' },
    { id: 3, title: 'Ship to production', done: false, priority: 'medium' },
  ]
  private nextId = 4

  findAll() {
    return this.tasks
  }
  findById(id: string) {
    return this.tasks.find((t) => t.id === Number(id)) ?? null
  }
  search(q: string) {
    return this.tasks.filter((t) => t.title.toLowerCase().includes((q ?? '').toLowerCase()))
  }
  create(data: { title: string; priority?: string }) {
    const task = {
      id: this.nextId++,
      title: data.title,
      done: false,
      priority: data.priority ?? 'medium',
    }
    this.tasks.push(task)
    return task
  }
  complete(id: string) {
    const task = this.tasks.find((t) => t.id === Number(id))
    if (task) task.done = true
    return task
  }
  remove(id: string) {
    const idx = this.tasks.findIndex((t) => t.id === Number(id))
    if (idx !== -1) this.tasks.splice(idx, 1)
  }
  stats() {
    return {
      total: this.tasks.length,
      done: this.tasks.filter((t) => t.done).length,
      pending: this.tasks.filter((t) => !t.done).length,
    }
  }
}

// ╔═══════════════════════════════════════════════════════════╗
// ║  2. DTOs — validação com Zod (Pattern D2: static schema)  ║
// ╚═══════════════════════════════════════════════════════════╝

const zCreateTask = z.object({
  title: z.string().min(3, 'Título mínimo 3 caracteres'),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
})
class CreateTaskDto {
  static schema = zCreateTask
}

// ╔═══════════════════════════════════════════════════════════╗
// ║  3. GUARDS — autenticação via header                      ║
// ╚═══════════════════════════════════════════════════════════╝

class AuthGuard {
  canActivate(req: IncomingMessage) {
    return req.headers['authorization'] === 'Bearer theokit-token'
  }
}

// ╔═══════════════════════════════════════════════════════════╗
// ║  4. CONTROLLERS — HTTP endpoints com @ syntax             ║
// ╚═══════════════════════════════════════════════════════════╝

@Controller('tasks')
class TasksController {
  private taskService: TaskService

  // Constructor Injection — DI resolve TaskService automaticamente
  constructor(taskService: TaskService) {
    this.taskService = taskService
  }

  @Get()
  @Header('X-App', 'theokit-example')
  findAll() {
    return this.taskService.findAll()
  }

  @Get('search')
  search(@Query('q') q: string) {
    return this.taskService.search(q)
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    const task = this.taskService.findById(id)
    return task ?? { error: 'Task not found' }
  }

  @Post()
  create(@Body() body: CreateTaskDto) {
    return this.taskService.create(body as z.infer<typeof zCreateTask>)
  }

  @Post(':id/complete')
  complete(@Param('id') id: string) {
    const task = this.taskService.complete(id)
    return task ?? { error: 'Task not found' }
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    this.taskService.remove(id)
  }

  @Get('stats')
  @UseGuards(AuthGuard)
  getStats() {
    return this.taskService.stats()
  }
}

@Controller('health')
class HealthController {
  @Get()
  check() {
    return {
      status: 'ok',
      app: 'TheoKit Task Manager',
      features: ['@Controller', '@Get/@Post/@Delete', '@Body + Zod', '@UseGuards', 'DI Container'],
    }
  }
}

// ╔═══════════════════════════════════════════════════════════╗
// ║  5. WIRING — parameter decorators (vitest/esbuild shim)   ║
// ║  Em produção com tsc, isso é automático.                  ║
// ╚═══════════════════════════════════════════════════════════╝

function wireParam(ctrl: Function, method: string, idx: number, src: string, key?: string) {
  const map = Reflect.getMetadata(ROUTE_PARAMS, ctrl) ?? new Map()
  const entries = map.get(method) ?? []
  entries.push({ source: src, key, index: idx })
  map.set(method, entries)
  setMeta(ROUTE_PARAMS, ctrl, map)
}
wireParam(TasksController, 'search', 0, 'query', 'q')
wireParam(TasksController, 'findById', 0, 'param', 'id')
wireParam(TasksController, 'create', 0, 'body', undefined)
wireParam(TasksController, 'complete', 0, 'param', 'id')
wireParam(TasksController, 'remove', 0, 'param', 'id')
Reflect.defineMetadata('design:paramtypes', [TaskService], TasksController)
Reflect.defineMetadata('design:paramtypes', [CreateTaskDto], TasksController.prototype, 'create')

// ╔═══════════════════════════════════════════════════════════╗
// ║  6. DI CONTAINER — simula @theokit/di Container           ║
// ╚═══════════════════════════════════════════════════════════╝

class Container implements DiContainer {
  private reg = new Map<Function, object>()
  register(t: Function, i: object) {
    this.reg.set(t, i)
  }
  resolve<T>(token: Function): T {
    const e = this.reg.get(token)
    if (e) return e as T
    const pts: Function[] = Reflect.getMetadata('design:paramtypes', token) ?? []
    const args = pts.map((p: Function) => {
      const d = this.reg.get(p)
      if (!d) throw new Error(`${p.name} not registered`)
      return d
    })
    const inst = new (token as new (...a: unknown[]) => T)(...args)
    this.reg.set(token, inst)
    return inst
  }
}

// ╔═══════════════════════════════════════════════════════════╗
// ║  7. TESTS — prova tudo end-to-end                         ║
// ╚═══════════════════════════════════════════════════════════╝

describe('TheoKit Task Manager — Example App', () => {
  let server: ReturnType<typeof createDecoratorServer>
  let port: number

  beforeAll(async () => {
    const container = new Container()
    container.register(TaskService, new TaskService())

    server = createDecoratorServer({
      controllers: [TasksController, HealthController],
      container,
    })
    await new Promise<void>((r) => server.listen(0, r))
    port = (server.address() as { port: number }).port
  })

  afterAll(() => server.close())

  it('GET /health → app info', async () => {
    const res = await fetch(`http://localhost:${port}/health`)
    expect(res.status).toBe(200)
    const data = (await res.json()) as { status: string; app: string }
    expect(data.status).toBe('ok')
    expect(data.app).toBe('TheoKit Task Manager')
  })

  it('GET /tasks → lista de tasks do TaskService injetado', async () => {
    const res = await fetch(`http://localhost:${port}/tasks`)
    expect(res.status).toBe(200)
    expect(res.headers.get('x-app')).toBe('theokit-example')
    const tasks = (await res.json()) as Array<{ title: string }>
    expect(tasks.length).toBe(3)
    expect(tasks[0].title).toBe('Learn TheoKit')
  })

  it('GET /tasks/search?q=agent → busca por texto', async () => {
    const res = await fetch(`http://localhost:${port}/tasks/search?q=agent`)
    const tasks = (await res.json()) as Array<{ title: string }>
    expect(tasks.length).toBe(1)
    expect(tasks[0].title).toContain('AI agent')
  })

  it('GET /tasks/1 → task por ID', async () => {
    const res = await fetch(`http://localhost:${port}/tasks/1`)
    expect(await res.json()).toMatchObject({ id: 1, title: 'Learn TheoKit', done: false })
  })

  it('POST /tasks → cria task com Zod validation (201)', async () => {
    const res = await fetch(`http://localhost:${port}/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Write docs', priority: 'high' }),
    })
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({
      id: 4,
      title: 'Write docs',
      done: false,
      priority: 'high',
    })
  })

  it('POST /tasks invalid → 422 Zod rejects', async () => {
    const res = await fetch(`http://localhost:${port}/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'ab' }), // min 3 chars
    })
    expect(res.status).toBe(422)
    const data = (await res.json()) as { error: { code: string } }
    expect(data.error.code).toBe('VALIDATION_ERROR')
  })

  it('POST /tasks/1/complete → marca task como done', async () => {
    const res = await fetch(`http://localhost:${port}/tasks/1/complete`, { method: 'POST' })
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ id: 1, done: true })
  })

  it('DELETE /tasks/2 → 204', async () => {
    const res = await fetch(`http://localhost:${port}/tasks/2`, { method: 'DELETE' })
    expect(res.status).toBe(204)
  })

  it('GET /tasks/stats sem auth → 401', async () => {
    const res = await fetch(`http://localhost:${port}/tasks/stats`)
    expect(res.status).toBe(401)
  })

  it('GET /tasks/stats com Bearer token → 200 stats', async () => {
    const res = await fetch(`http://localhost:${port}/tasks/stats`, {
      headers: { authorization: 'Bearer theokit-token' },
    })
    expect(res.status).toBe(200)
    const stats = (await res.json()) as { total: number; done: number; pending: number }
    expect(stats.done).toBe(1) // task 1 was completed above
    expect(stats.total).toBe(3) // 3 original - 1 deleted + 1 created = 3
  })
})
