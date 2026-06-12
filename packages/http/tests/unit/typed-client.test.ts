import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import 'reflect-metadata'
import { z } from 'zod'
import { Controller, Get, Post, Delete, Body, Param, HttpCode } from '../../src/index.js'
import { TheoApp } from '../../src/app.js'
import { contract, createTypedClient, TypedClientError } from '../../src/index.js'
import type { TypedClient } from '../../src/typed-client.js'

// Bun lacks emitDecoratorMetadata support (same as esbuild). Tests using
// decorator syntax require SWC compilation provided by vitest. Skip on Bun.
const isVitest = typeof process !== 'undefined' && !!process.env.VITEST

// ── Shared Contract (this is what server + client both import) ──

interface Task {
  id: number
  title: string
  done: boolean
}

const zCreateTask = z.object({
  title: z.string().min(3),
})

const _routes = contract({
  'GET /api/tasks': { response: [] as Task[] },
  'GET /api/tasks/:id': { response: {} as Task },
  'POST /api/tasks': { body: zCreateTask, response: {} as Task },
  'DELETE /api/tasks/:id': { response: undefined as undefined },
})
type AppRoutes = typeof _routes

// ── Server (uses same Zod schemas from contract) ──

const store: Task[] = [
  { id: 1, title: 'First task', done: false },
  { id: 2, title: 'Second task', done: true },
]

@Controller('api/tasks')
class TasksController {
  @Get()
  list(): Task[] {
    return store
  }

  @Get(':id')
  find(@Param('id') id: string): Task {
    return store.find((t) => t.id === Number(id)) ?? { id: 0, title: 'not found', done: false }
  }

  @Post()
  create(@Body(zCreateTask) body: z.infer<typeof zCreateTask>): Task {
    const task = { id: store.length + 1, title: body.title, done: false }
    store.push(task)
    return task
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') _id: string) {
    return undefined
  }
}

// ── Tests ──

describe.skipIf(!isVitest)('TypedClient — end-to-end type inference', () => {
  let app: TheoApp
  let client: TypedClient<AppRoutes>
  let port: number

  beforeAll(async () => {
    app = await TheoApp.create({ controllers: [TasksController] })
    const handle = app.getServerHandle()
    await new Promise<void>((r) => handle.listen(0, r))
    port = handle.address()?.port ?? 0
    client = createTypedClient<AppRoutes>(`http://localhost:${port}`)
  })

  afterAll(async () => {
    await app.close()
  })

  it('test_get_returns_typed_array', async () => {
    const tasks = await client.get('/api/tasks')
    expect(Array.isArray(tasks)).toBe(true)
    expect(tasks[0]).toHaveProperty('id')
    expect(tasks[0]).toHaveProperty('title')
    expect(tasks[0]).toHaveProperty('done')
    // TypeScript knows: tasks is Task[]
  })

  it('test_get_with_param', async () => {
    const task = await client.get('/api/tasks/1' as '/api/tasks/:id')
    expect(task).toHaveProperty('id')
    // TypeScript knows: task is Task
  })

  it('test_post_with_typed_body', async () => {
    const task = await client.post('/api/tasks', { title: 'New task' })
    expect(task).toHaveProperty('id')
    expect(task.title).toBe('New task')
    // TypeScript knows: body must be { title: string }, response is Task
  })

  it('test_delete_returns_void', async () => {
    const result = await client.delete('/api/tasks/1' as '/api/tasks/:id')
    expect(result).toBeUndefined()
    // TypeScript knows: result is void
  })

  it('test_error_throws_typed_error', async () => {
    // POST with invalid body (too short title)
    try {
      await client.post('/api/tasks', { title: 'ab' } as { title: string })
      expect.fail('Should throw')
    } catch (e) {
      expect(e).toBeInstanceOf(TypedClientError)
      expect((e as TypedClientError).status).toBe(422)
    }
  })

  it('test_contract_is_identity', () => {
    // contract() is zero-overhead — returns the same object
    const input = { 'GET /test': { response: 'hello' as string } }
    const output = contract(input)
    expect(output).toBe(input) // same reference
  })
})
