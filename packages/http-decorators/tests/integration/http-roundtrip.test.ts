import 'reflect-metadata'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { z } from 'zod'
import type { IncomingMessage } from 'node:http'
import { Controller } from '../../src/decorators/controller.js'
import { Get, Post, Delete } from '../../src/decorators/methods.js'
import { Body, Param, Query } from '../../src/decorators/params.js'
import { HttpCode, Header } from '../../src/decorators/response.js'
import { UseGuards } from '../../src/decorators/middleware.js'
import { createDecoratorServer } from '../../src/bridge/create-server.js'

// ─── Fixtures ──────────────────────────────────────────────────

const zCreateCat = z.object({ name: z.string().min(1), age: z.number().min(0) })

class CreateCatDto {
  static schema = zCreateCat
}

class RejectAllGuard {
  canActivate(_req: IncomingMessage) {
    return false
  }
}

@Controller('cats')
class CatsController {
  @Get()
  findAll() {
    return 'This action returns all cats'
  }

  @Get('search')
  @Header('X-Custom', 'test-value')
  search(@Query('breed') breed: string) {
    return { breed, found: true }
  }

  @Post()
  create(@Body() body: CreateCatDto) {
    return { created: true, name: (body as z.infer<typeof zCreateCat>).name }
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return { id, name: `Cat #${id}` }
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') _id: string) {
    // 204 no content
  }

  @Get('admin/secret')
  @UseGuards(RejectAllGuard)
  adminOnly() {
    return 'should never reach here'
  }
}

// Simulate tsc emitDecoratorMetadata for @Body() DTO injection
Reflect.defineMetadata('design:paramtypes', [CreateCatDto], CatsController.prototype, 'create')

// ─── Tests ─────────────────────────────────────────────────────

describe('T-final — HTTP roundtrip integration (real fetch → real handler)', () => {
  let server: ReturnType<typeof createDecoratorServer>
  let port: number

  beforeAll(async () => {
    server = createDecoratorServer([CatsController])
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address()
        port = typeof addr === 'object' && addr ? addr.port : 0
        resolve()
      })
    })
  })

  afterAll(() => {
    server.close()
  })

  it('GET /cats returns 200 with handler string', async () => {
    const res = await fetch(`http://localhost:${port}/cats`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/plain')
    expect(await res.text()).toBe('This action returns all cats')
  })

  it('GET /cats/search?breed=siamese returns JSON with query param', async () => {
    const res = await fetch(`http://localhost:${port}/cats/search?breed=siamese`)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toEqual({ breed: 'siamese', found: true })
    expect(res.headers.get('x-custom')).toBe('test-value')
  })

  it('POST /cats with valid body returns 201 + created response', async () => {
    const res = await fetch(`http://localhost:${port}/cats`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Whiskers', age: 3 }),
    })
    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data).toEqual({ created: true, name: 'Whiskers' })
  })

  it('POST /cats with invalid body returns 422 VALIDATION_ERROR', async () => {
    const res = await fetch(`http://localhost:${port}/cats`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '', age: -1 }),
    })
    expect(res.status).toBe(422)
    const data = await res.json()
    expect(data.error.code).toBe('VALIDATION_ERROR')
    expect(data.error.issues.length).toBeGreaterThan(0)
  })

  it('GET /cats/:id returns param-extracted response', async () => {
    const res = await fetch(`http://localhost:${port}/cats/42`)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toEqual({ id: '42', name: 'Cat #42' })
  })

  it('DELETE /cats/:id returns 204 via @HttpCode', async () => {
    const res = await fetch(`http://localhost:${port}/cats/99`, { method: 'DELETE' })
    expect(res.status).toBe(204)
  })

  it('GET /cats/admin/secret returns 401 via @UseGuards(RejectAllGuard)', async () => {
    const res = await fetch(`http://localhost:${port}/cats/admin/secret`)
    expect(res.status).toBe(401)
    const data = await res.json()
    expect(data.error.code).toBe('UNAUTHORIZED')
  })

  it('GET /nonexistent returns 404', async () => {
    const res = await fetch(`http://localhost:${port}/nonexistent`)
    expect(res.status).toBe(404)
    const data = await res.json()
    expect(data.error.code).toBe('NOT_FOUND')
  })
})
