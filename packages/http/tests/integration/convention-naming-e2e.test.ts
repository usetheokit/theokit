/**
 * Convention Naming E2E — validates Rails-style class name → route inference.
 * Real HTTP requests against TheoApp with convention-named controllers.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import 'reflect-metadata'
import { z } from 'zod'
import { Controller, Get, Post, Put, Delete, Body, Param, HttpCode } from '../../src/index.js'
import { TheoApp } from '../../src/app.js'

// Bun lacks emitDecoratorMetadata support (same as esbuild). Tests using
// decorator syntax require SWC compilation provided by vitest. Skip on Bun.
const isVitest = typeof process !== 'undefined' && !!process.env.VITEST

// ── Convention controllers (NO explicit path) ──

@Controller()
class UsersController {
  @Get() list() {
    return [{ id: 1, name: 'Alice' }]
  }
  @Get(':id') find(@Param('id') id: string) {
    return { id: Number(id), name: 'Alice' }
  }
  @Post() create(@Body(z.object({ name: z.string() })) b: { name: string }) {
    return { id: 2, ...b }
  }
  @Put(':id') update(
    @Param('id') id: string,
    @Body(z.object({ name: z.string() })) b: { name: string },
  ) {
    return { id: Number(id), ...b }
  }
  @Delete(':id') @HttpCode(204) remove() {
    return undefined
  }
}

@Controller()
class ProductsController {
  @Get() list() {
    return [{ id: 1, title: 'Widget' }]
  }
  @Get(':id') find(@Param('id') id: string) {
    return { id: Number(id), title: 'Widget' }
  }
  @Post() create(
    @Body(z.object({ title: z.string(), price: z.number() })) b: { title: string; price: number },
  ) {
    return { id: 2, ...b }
  }
}

@Controller()
class OrderItemsController {
  @Get() list() {
    return [{ id: 1, orderId: 1, product: 'Widget' }]
  }
}

@Controller()
class HealthCheckController {
  @Get() check() {
    return { status: 'ok' }
  }
}

// ── Explicit override controller ──
@Controller('api/v2/legacy')
class LegacyController {
  @Get() list() {
    return [{ legacy: true }]
  }
}

describe.skipIf(!isVitest)('Convention Naming E2E', () => {
  let app: TheoApp
  let base: string

  beforeAll(async () => {
    app = await TheoApp.create({
      controllers: [
        UsersController,
        ProductsController,
        OrderItemsController,
        HealthCheckController,
        LegacyController,
      ],
    })
    const h = app.getServerHandle()
    await new Promise<void>((r) => h.listen(0, r))
    base = `http://localhost:${h.address()?.port}`
  })

  afterAll(async () => {
    await app.close()
  })

  const json = async (path: string, init?: RequestInit) => {
    const res = await fetch(`${base}${path}`, init)
    return { status: res.status, body: await res.json().catch(() => null) }
  }

  // ── UsersController → /api/users ──

  it('GET /api/users → list', async () => {
    const { status, body } = await json('/api/users')
    expect(status).toBe(200)
    expect(body).toHaveLength(1)
  })

  it('GET /api/users/1 → find', async () => {
    const { status, body } = await json('/api/users/1')
    expect(status).toBe(200)
    expect((body as { name: string }).name).toBe('Alice')
  })

  it('POST /api/users → create', async () => {
    const { status, body } = await json('/api/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Bob' }),
    })
    expect(status).toBe(201)
    expect((body as { name: string }).name).toBe('Bob')
  })

  it('PUT /api/users/1 → update', async () => {
    const { status, body } = await json('/api/users/1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Updated' }),
    })
    expect(status).toBe(200)
    expect((body as { name: string }).name).toBe('Updated')
  })

  it('DELETE /api/users/1 → 204', async () => {
    const res = await fetch(`${base}/api/users/1`, { method: 'DELETE' })
    expect(res.status).toBe(204)
  })

  // ── ProductsController → /api/products ──

  it('GET /api/products → list', async () => {
    const { status } = await json('/api/products')
    expect(status).toBe(200)
  })

  it('GET /api/products/1 → find', async () => {
    const { status, body } = await json('/api/products/1')
    expect(status).toBe(200)
    expect((body as { title: string }).title).toBe('Widget')
  })

  it('POST /api/products → create with validation', async () => {
    const { status } = await json('/api/products', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Gadget', price: 29.99 }),
    })
    expect(status).toBe(201)
  })

  it('POST /api/products → 422 on invalid body', async () => {
    const { status } = await json('/api/products', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 123 }),
    })
    expect(status).toBe(422)
  })

  // ── OrderItemsController → /api/order-items (PascalCase → kebab-case) ──

  it('GET /api/order-items → kebab-case convention', async () => {
    const { status, body } = await json('/api/order-items')
    expect(status).toBe(200)
    expect(body).toHaveLength(1)
  })

  // ── HealthCheckController → /api/health-check ──

  it('GET /api/health-check → multi-word convention', async () => {
    const { status, body } = await json('/api/health-check')
    expect(status).toBe(200)
    expect((body as { status: string }).status).toBe('ok')
  })

  // ── LegacyController → /api/v2/legacy (explicit override) ──

  it('GET /api/v2/legacy → explicit override works', async () => {
    const { status, body } = await json('/api/v2/legacy')
    expect(status).toBe(200)
    expect(body).toBeDefined()
  })

  // ── 404 on wrong paths ──

  it('GET /users (no /api prefix) → 404', async () => {
    const { status } = await json('/users')
    expect(status).toBe(404)
  })

  it('GET /api/nonexistent → 404', async () => {
    const { status } = await json('/api/nonexistent')
    expect(status).toBe(404)
  })

  // ── Health probes bypass convention ──

  it('GET /__theo/health → 200 (not affected by convention)', async () => {
    const { status } = await json('/__theo/health')
    expect(status).toBe(200)
  })

  it('GET /__theo/ready → 200', async () => {
    const { status } = await json('/__theo/ready')
    expect(status).toBe(200)
  })
})
