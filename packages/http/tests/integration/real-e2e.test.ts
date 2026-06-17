/**
 * REAL end-to-end test: TheoApp + Controller + TypedClient + Health probes.
 *
 * Boots a real HTTP server, makes real fetch() requests, validates responses.
 * Runs via vitest (SWC handles decorators).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import 'reflect-metadata'
import { z } from 'zod'
import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  HttpCode,
  NotFoundException,
} from '../../src/index.js'
import { TheoApp } from '../../src/app.js'
import { createTypedClient, TypedClientError, contract } from '../../src/index.js'

// Bun lacks emitDecoratorMetadata support (same as esbuild). Tests using
// decorator syntax require SWC compilation provided by vitest. Skip on Bun.
const isVitest = typeof process !== 'undefined' && !!process.env.VITEST

// ── In-memory store ──
const tasks = [
  { id: 1, title: 'Setup TheoKit', priority: 'high', done: true },
  { id: 2, title: 'Build AI Agent', priority: 'medium', done: false },
]
let nextId = 3
const zCreate = z.object({
  title: z.string().min(3),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
})

// ── Controller ──
@Controller('api/tasks')
class TasksCtrl {
  @Get()
  list() {
    return tasks
  }

  @Get(':id')
  find(@Param('id') id: string) {
    const t = tasks.find((t) => t.id === Number(id))
    if (!t) throw new NotFoundException('Task not found')
    return t
  }

  @Post()
  create(@Body(zCreate) b: z.infer<typeof zCreate>) {
    const t = { id: nextId++, ...b, done: false }
    tasks.push(t)
    return t
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    const idx = tasks.findIndex((t) => t.id === Number(id))
    if (idx === -1) throw new NotFoundException('Task not found')
    tasks.splice(idx, 1)
  }
}

// ── Readiness checks ──
const healthyCheck = async () => ({ name: 'db', healthy: true })
const _failingCheck = async () => ({ name: 'redis', healthy: false, message: 'connection refused' })

describe.skipIf(!isVitest)('Real E2E — TheoKit Full-Stack', () => {
  let app: TheoApp
  let port: number
  let baseUrl: string

  beforeAll(async () => {
    app = await TheoApp.create({
      controllers: [TasksCtrl],
      readinessChecks: [healthyCheck],
    })
    const handle = app.getServerHandle()
    await new Promise<void>((r) => handle.listen(0, r))
    port = handle.address()?.port ?? 0
    baseUrl = `http://localhost:${port}`
  })

  afterAll(async () => {
    await app.close()
  })

  // ── Health Probes ──

  it('GET /__theo/health returns ok + uptime', async () => {
    const res = await fetch(`${baseUrl}/__theo/health`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string; uptime: number; timestamp: number }
    expect(body.status).toBe('ok')
    expect(body.uptime).toBeGreaterThan(0)
    expect(body.timestamp).toBeGreaterThan(0)
  })

  it('GET /__theo/ready returns ready when checks pass', async () => {
    const res = await fetch(`${baseUrl}/__theo/ready`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      status: string
      checks: { name: string; healthy: boolean }[]
    }
    expect(body.status).toBe('ready')
    expect(body.checks[0].name).toBe('db')
    expect(body.checks[0].healthy).toBe(true)
  })

  // ── CRUD via raw fetch ──

  it('GET /api/tasks returns task array', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as unknown[]
    expect(body).toHaveLength(2)
  })

  it('GET /api/tasks/:id returns single task', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/1`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { id: number; title: string }
    expect(body.id).toBe(1)
    expect(body.title).toBe('Setup TheoKit')
  })

  it('POST /api/tasks creates task with Zod validation', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Real E2E Task', priority: 'high' }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: number; title: string; done: boolean }
    expect(body.id).toBe(3)
    expect(body.title).toBe('Real E2E Task')
    expect(body.done).toBe(false)
  })

  it('POST /api/tasks rejects invalid body (422)', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'ab' }), // too short
    })
    expect(res.status).toBe(422)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('VALIDATION_ERROR')
  })

  it('GET /api/tasks/999 returns 404', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/999`)
    expect(res.status).toBe(404)
  })

  it('GET /nonexistent returns 404 with clean error', async () => {
    const res = await fetch(`${baseUrl}/nonexistent`)
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('NOT_FOUND')
    // Security: no stack traces or internal details
    expect(JSON.stringify(body)).not.toContain('at ')
    expect(JSON.stringify(body)).not.toContain('.ts:')
  })

  // ── TypedClient ──

  it('TypedClient.get() returns typed response', async () => {
    const client =
      createTypedClient<Record<string, { body: z.ZodType; response: unknown }>>(baseUrl)
    const tasks = (await client.get('/api/tasks')) as unknown[]
    expect(Array.isArray(tasks)).toBe(true)
    expect(tasks.length).toBeGreaterThanOrEqual(2)
  })

  it('TypedClient.post() sends body and returns typed response', async () => {
    const client =
      createTypedClient<Record<string, { body: z.ZodType; response: unknown }>>(baseUrl)
    const task = (await client.post('/api/tasks', { title: 'Client Task', priority: 'low' })) as {
      id: number
      title: string
    }
    expect(task.title).toBe('Client Task')
    expect(task.id).toBeGreaterThan(0)
  })

  it('TypedClient throws TypedClientError on 422', async () => {
    const client =
      createTypedClient<Record<string, { body: z.ZodType; response: unknown }>>(baseUrl)
    await expect(client.post('/api/tasks', { title: 'ab' })).rejects.toThrow(TypedClientError)
  })

  it('contract() is zero-overhead identity', () => {
    const input = { 'GET /test': { response: 'hello' as string } }
    expect(contract(input)).toBe(input)
  })
})
