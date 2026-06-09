import 'reflect-metadata'
import { createServer } from 'node:http'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { z } from 'zod'
import { Controller } from '../../src/decorators/controller.js'
import { Get, Post, Delete } from '../../src/decorators/methods.js'
import { Body, Param, Query } from '../../src/decorators/params.js'
import { HttpCode, Header } from '../../src/decorators/response.js'
import { UseGuards } from '../../src/decorators/middleware.js'
import { setMeta, ROUTE_PARAMS } from '../../src/metadata/index.js'
import { httpDecoratorsPlugin } from '../../src/theokit-plugin.js'

// ── Fixtures ──────────────────────────────────────────

const zCreateCat = z.object({ name: z.string().min(1), age: z.number().min(0) })
class CreateCatDto {
  static schema = zCreateCat
}
class RejectGuard {
  canActivate() {
    return false
  }
}

@Controller('cats')
class CatsCtrl {
  @Get() findAll() {
    return [{ id: 1, name: 'Whiskers' }]
  }
  @Get('search') search(breed: string) {
    return { breed }
  }
  @Get(':id') findOne(id: string) {
    return { id }
  }
  @Post() create(body: CreateCatDto) {
    return { created: true, ...(body as z.infer<typeof zCreateCat>) }
  }
  @Delete(':id') @HttpCode(204) remove(_id: string) {}
  @Get('admin') @UseGuards(RejectGuard) admin() {
    return 'secret'
  }
}

// Wire parameter decorators manually (esbuild limitation)
function wireParam(ctrl: Function, method: string, index: number, source: string, key?: string) {
  const map = Reflect.getMetadata(ROUTE_PARAMS, ctrl) ?? new Map()
  const entries = map.get(method) ?? []
  entries.push({ source, key, index })
  map.set(method, entries)
  setMeta(ROUTE_PARAMS, ctrl, map)
}
wireParam(CatsCtrl, 'search', 0, 'query', 'breed')
wireParam(CatsCtrl, 'findOne', 0, 'param', 'id')
wireParam(CatsCtrl, 'create', 0, 'body', undefined)
wireParam(CatsCtrl, 'remove', 0, 'param', 'id')
Reflect.defineMetadata('design:paramtypes', [CreateCatDto], CatsCtrl.prototype, 'create')

// ── Simulated TheoKit plugin system ───────────────────
// This mirrors what TheoKit's plugin-runner does: calls plugin.register(app)
// where app provides addHook('onRequest', fn). The fn receives
// {request: IncomingMessage, response: ServerResponse, ctx, requestId}.

describe('TheoKit plugin integration — httpDecoratorsPlugin', () => {
  let server: ReturnType<typeof createServer>
  let port: number

  beforeAll(async () => {
    const plugin = httpDecoratorsPlugin({ controllers: [CatsCtrl] })

    // Collect onRequest hooks (same as TheoKit's PluginRunner)
    const hooks: Function[] = []
    const fakeApp = {
      addHook: (name: string, fn: Function) => {
        if (name === 'onRequest') hooks.push(fn)
      },
    }
    plugin.register(fakeApp as Parameters<typeof plugin.register>[0])

    // Create a server that runs onRequest hooks THEN falls through to 404
    // (mirrors TheoKit's execute.ts pipeline)
    server = createServer(async (req, res) => {
      const pluginCtx = { request: req, response: res, ctx: {}, requestId: 'test' }
      for (const hook of hooks) {
        await hook(pluginCtx)
        if (res.writableEnded || res.headersSent) return // short-circuited
      }
      // No plugin handled it — TheoKit's normal route scanner would run here
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({ error: { code: 'NOT_FOUND', message: 'No TheoKit file-route matched' } }),
      )
    })

    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address()
        port = typeof addr === 'object' && addr ? addr.port : 0
        resolve()
      })
    })
  })

  afterAll(() => server.close())

  it('GET /cats → 200 (plugin intercepts before TheoKit scanner)', async () => {
    const res = await fetch(`http://localhost:${port}/cats`)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toEqual([{ id: 1, name: 'Whiskers' }])
  })

  it('GET /cats/search?breed=siamese → query param extracted', async () => {
    const res = await fetch(`http://localhost:${port}/cats/search?breed=siamese`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ breed: 'siamese' })
  })

  it('GET /cats/42 → param extraction', async () => {
    const res = await fetch(`http://localhost:${port}/cats/42`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: '42' })
  })

  it('POST /cats valid → 201 + Zod validated body', async () => {
    const res = await fetch(`http://localhost:${port}/cats`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Mittens', age: 2 }),
    })
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ created: true, name: 'Mittens', age: 2 })
  })

  it('POST /cats invalid → 422 VALIDATION_ERROR', async () => {
    const res = await fetch(`http://localhost:${port}/cats`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '', age: -1 }),
    })
    expect(res.status).toBe(422)
    const data = await res.json()
    expect(data.error.code).toBe('VALIDATION_ERROR')
  })

  it('DELETE /cats/1 → 204 @HttpCode', async () => {
    const res = await fetch(`http://localhost:${port}/cats/1`, { method: 'DELETE' })
    expect(res.status).toBe(204)
  })

  it('GET /cats/admin → 401 @UseGuards', async () => {
    const res = await fetch(`http://localhost:${port}/cats/admin`)
    expect(res.status).toBe(401)
    expect((await res.json()).error.code).toBe('UNAUTHORIZED')
  })

  it('GET /unknown → 404 falls through to TheoKit scanner (plugin does not intercept)', async () => {
    const res = await fetch(`http://localhost:${port}/unknown`)
    expect(res.status).toBe(404)
    const data = await res.json()
    expect(data.error.message).toContain('No TheoKit file-route matched')
  })

  it('plugin.name is @theokit/http-decorators', () => {
    const plugin = httpDecoratorsPlugin({ controllers: [CatsCtrl] })
    expect(plugin.name).toBe('@theokit/http-decorators')
  })
})
