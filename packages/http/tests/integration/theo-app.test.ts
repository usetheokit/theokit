/**
 * TheoApp.create() — Spring Boot / NestFactory style bootstrap test.
 *
 * Zero boilerplate: @Module declares controllers + providers,
 * TheoApp.create() wires DI + mounts routes automatically.
 */
import 'reflect-metadata'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { z } from 'zod'
import type { ExecutionContext } from '../../src/bridge/execution-context.js'
import {
  Controller, Get, Post, Delete,
  Body, Param, Query,
  HttpCode, UseGuards,
  TheoApp,
  setMeta, ROUTE_PARAMS,
} from '../../src/index.js'

// ── Service ────────────────────────────────────────────

class CatService {
  private cats = [{ id: 1, name: 'Whiskers' }, { id: 2, name: 'Shadow' }]
  private nextId = 3

  findAll() { return this.cats }
  findById(id: string) { return this.cats.find(c => c.id === Number(id)) ?? null }
  create(data: { name: string }) { const c = { id: this.nextId++, ...data }; this.cats.push(c); return c }
  remove(id: string) { const i = this.cats.findIndex(c => c.id === Number(id)); if (i !== -1) this.cats.splice(i, 1) }
}

// ── DTO ────────────────────────────────────────────────

const zCreateCat = z.object({ name: z.string().min(1) })
class CreateCatDto { static schema = zCreateCat }

// ── Guard ──────────────────────────────────────────────

class ApiKeyGuard {
  canActivate(context: ExecutionContext) { const req = context.getRequest(); return req.headers.get('x-api-key') === 'cats-secret' }
}

// ── Controller ─────────────────────────────────────────

@Controller('cats')
class CatsController {
  constructor(private catService: CatService) {}

  @Get()
  findAll() { return this.catService.findAll() }

  @Get(':id')
  findById(@Param('id') id: string) { return this.catService.findById(id) ?? { error: 'not found' } }

  @Post()
  create(@Body() body: CreateCatDto) { return this.catService.create(body as z.infer<typeof zCreateCat>) }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string) { this.catService.remove(id) }

  @Get('secret')
  @UseGuards(ApiKeyGuard)
  secret() { return { secret: 'meow' } }
}

@Controller('health')
class HealthCtrl {
  @Get()
  check() { return { status: 'ok' } }
}

// Wire params (vitest/esbuild shim)
function wp(c: Function, m: string, i: number, s: string, k?: string) {
  const map = Reflect.getMetadata(ROUTE_PARAMS, c) ?? new Map()
  const entries = map.get(m) ?? []
  entries.push({ source: s, key: k, index: i })
  map.set(m, entries)
  setMeta(ROUTE_PARAMS, c, map)
}
wp(CatsController, 'findById', 0, 'param', 'id')
wp(CatsController, 'create', 0, 'body', undefined)
wp(CatsController, 'remove', 0, 'param', 'id')
Reflect.defineMetadata('design:paramtypes', [CatService], CatsController)
Reflect.defineMetadata('design:paramtypes', [CreateCatDto], CatsController.prototype, 'create')

// ── Tests ──────────────────────────────────────────────

describe('TheoApp.create() — NestFactory/SpringBoot style', () => {
  let app: TheoApp
  let port: number

  beforeAll(async () => {
    app = await TheoApp.create({
      controllers: [CatsController, HealthCtrl],
      providers: [CatService],
    })
    const server = app.getServerHandle()
    await new Promise<void>(r => server.listen(0, r))
    port = (server.address() as { port: number }).port
  })

  afterAll(async () => app.close())

  it('GET /health → 200', async () => {
    const res = await fetch(`http://localhost:${port}/health`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })

  it('GET /cats → DI-injected CatService returns data', async () => {
    const res = await fetch(`http://localhost:${port}/cats`)
    expect(res.status).toBe(200)
    const data = await res.json() as Array<{ name: string }>
    expect(data.length).toBe(2)
    expect(data[0].name).toBe('Whiskers')
  })

  it('POST /cats valid → 201', async () => {
    const res = await fetch(`http://localhost:${port}/cats`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Luna' }),
    })
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ id: 3, name: 'Luna' })
  })

  it('POST /cats invalid → 422 Zod', async () => {
    const res = await fetch(`http://localhost:${port}/cats`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    })
    expect(res.status).toBe(422)
  })

  it('DELETE /cats/2 → 204', async () => {
    const res = await fetch(`http://localhost:${port}/cats/2`, { method: 'DELETE' })
    expect(res.status).toBe(204)
  })

  it('GET /cats/secret sem key → 403', async () => {
    expect((await fetch(`http://localhost:${port}/cats/secret`)).status).toBe(403)
  })

  it('GET /cats/secret com key → 200', async () => {
    const res = await fetch(`http://localhost:${port}/cats/secret`, { headers: { 'x-api-key': 'cats-secret' } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ secret: 'meow' })
  })
})
