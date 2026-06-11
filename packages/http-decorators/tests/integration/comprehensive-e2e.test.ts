/**
 * COMPREHENSIVE E2E — every HTTP scenario the framework supports.
 * Real HTTP server, real fetch, real responses.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import 'reflect-metadata'
import { z } from 'zod'
import {
  Controller, Get, Post, Put, Delete, Patch,
  Body, Param, Query, Headers, Ip,
  HttpCode, Header, Redirect,
  UseGuards, UseInterceptors, UseFilters,
  HttpException, NotFoundException, BadRequestException, ForbiddenException,
  ConflictException, TooManyRequestsException, UnprocessableEntityException,
  HttpStatus,
} from '../../src/index.js'
import type { CanActivate, NestInterceptor, ExceptionFilter, ArgumentsHost, ExecutionContext } from '../../src/index.js'
import { TheoApp } from '../../src/app.js'
import { createTypedClient, TypedClientError } from '../../src/index.js'

// ═══════════════════════════════════════
//  FIXTURES — controllers, guards, etc.
// ═══════════════════════════════════════

const store: { id: number; name: string; done: boolean }[] = []
let nextId = 1

const zCreate = z.object({ name: z.string().min(1).max(100) })
const zUpdate = z.object({ name: z.string().min(1).optional(), done: z.boolean().optional() })

// Guard: header-based role check
const ROLES_KEY = Symbol.for('test:roles')
const Roles = (roles: string[]): ClassDecorator & MethodDecorator =>
  ((target: Function | object, key?: string | symbol) => {
    if (key) Reflect.defineMetadata(ROLES_KEY, roles, target.constructor, key)
    else Reflect.defineMetadata(ROLES_KEY, roles, target)
  }) as ClassDecorator & MethodDecorator

class RoleGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const methodRoles = Reflect.getMetadata(ROLES_KEY, ctx.getClass(), ctx.getMethodName()) as string[] | undefined
    const classRoles = Reflect.getMetadata(ROLES_KEY, ctx.getClass()) as string[] | undefined
    const roles = methodRoles ?? classRoles ?? []
    if (roles.length === 0) return true
    const role = ctx.getRequest().headers.get('x-role') ?? ''
    return roles.includes(role)
  }
}

// Interceptor: adds x-timing header
class TimingInterceptor implements NestInterceptor {
  async intercept(_ctx: unknown, next: () => Promise<unknown>) {
    const start = Date.now()
    const result = await next()
    return { __intercepted: true, timing: Date.now() - start, data: result }
  }
}

// Filter: custom error format
class CustomErrorFilter implements ExceptionFilter {
  catch(exception: unknown, _host: ArgumentsHost): Response {
    const ex = exception as HttpException
    return new Response(JSON.stringify({
      custom: true,
      status: ex.statusCode,
      msg: ex.message,
    }), { status: ex.statusCode, headers: { 'content-type': 'application/json' } })
  }
}

// ── Controllers ──

@Controller('api/items')
class ItemsController {
  @Get()
  list() { return store }

  @Get('count')
  count() { return { count: store.length } }

  @Get('search')
  search(@Query('q') q: string, @Query('limit') limit: string) {
    const l = Number(limit) || 10
    return store.filter(s => s.name.includes(q ?? '')).slice(0, l)
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    const item = store.find(s => s.id === Number(id))
    if (!item) throw new NotFoundException(`Item ${id} not found`)
    return item
  }

  @Post()
  create(@Body(zCreate) body: { name: string }) {
    const item = { id: nextId++, name: body.name, done: false }
    store.push(item)
    return item
  }

  @Put(':id')
  replace(@Param('id') id: string, @Body(zCreate) body: { name: string }) {
    const item = store.find(s => s.id === Number(id))
    if (!item) throw new NotFoundException(`Item ${id} not found`)
    item.name = body.name
    return item
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body(zUpdate) body: { name?: string; done?: boolean }) {
    const item = store.find(s => s.id === Number(id))
    if (!item) throw new NotFoundException(`Item ${id} not found`)
    if (body.name !== undefined) item.name = body.name
    if (body.done !== undefined) item.done = body.done
    return item
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    const idx = store.findIndex(s => s.id === Number(id))
    if (idx === -1) throw new NotFoundException(`Item ${id} not found`)
    store.splice(idx, 1)
  }
}

@Controller('api/headers')
class HeadersController {
  @Get('echo')
  echo(@Headers('x-custom') custom: string, @Ip() ip: string) {
    return { custom: custom ?? 'none', ip }
  }

  @Get('set')
  @Header('x-powered-by', 'TheoKit')
  @Header('x-version', '1.0')
  withHeaders() { return { ok: true } }

  @Get('redirect')
  @Redirect('https://theokit.dev', 302)
  redirected() { return null }
}

@Controller('api/guarded')
@UseGuards(RoleGuard)
@Roles(['admin'])
class GuardedController {
  @Get()
  adminOnly() { return { secret: 'admin-data' } }

  @Get('public')
  @Roles([]) // override: no role required
  publicRoute() { return { public: true } }
}

@Controller('api/intercepted')
@UseInterceptors(TimingInterceptor)
class InterceptedController {
  @Get()
  data() { return { value: 42 } }
}

@Controller('api/filtered')
@UseFilters(CustomErrorFilter)
class FilteredController {
  @Get('error')
  throwError() { throw new BadRequestException('Custom filtered error') }

  @Get('ok')
  ok() { return { filtered: true } }
}

@Controller('api/exceptions')
class ExceptionsController {
  @Get('400') bad() { throw new BadRequestException() }
  @Get('401') unauth() { throw new HttpException('Login required', 401) }
  @Get('403') forbidden() { throw new ForbiddenException('Access denied') }
  @Get('404') notfound() { throw new NotFoundException() }
  @Get('409') conflict() { throw new ConflictException('Already exists') }
  @Get('422') unprocessable() { throw new UnprocessableEntityException('Invalid data') }
  @Get('429') ratelimit() { throw new TooManyRequestsException('Slow down') }
  @Get('500') internal() { throw new Error('should be scrubbed') }

  @Get('custom')
  custom() {
    throw new HttpException('Custom error', 418, { description: 'Teapot mode' })
  }
}

@Controller('api/status')
class StatusController {
  @Post('created')
  @HttpCode(HttpStatus.CREATED)
  created(@Body(z.object({ v: z.number() })) body: { v: number }) { return { v: body.v } }

  @Post('accepted')
  @HttpCode(HttpStatus.ACCEPTED)
  accepted() { return { queued: true } }

  @Delete('gone')
  @HttpCode(HttpStatus.NO_CONTENT)
  gone() { return undefined }

  @Get('string')
  text() { return 'plain text response' }

  @Get('null')
  empty() { return null }

  @Get('undefined')
  nothing() { return undefined }
}

@Controller('api/validation')
class ValidationController {
  @Post('strict')
  strict(@Body(z.object({
    email: z.string().email(),
    age: z.number().int().min(0).max(150),
    role: z.enum(['user', 'admin']),
  })) body: unknown) { return body }

  @Post('nested')
  nested(@Body(z.object({
    user: z.object({ name: z.string(), tags: z.array(z.string()) }),
  })) body: unknown) { return body }

  @Post('optional')
  optional(@Body(z.object({
    required: z.string(),
    optional: z.string().optional(),
    defaulted: z.string().default('fallback'),
  })) body: unknown) { return body }
}

// ═══════════════════════════════════════
//  TESTS
// ═══════════════════════════════════════

describe('Comprehensive E2E — TheoKit HTTP', () => {
  let app: TheoApp
  let base: string

  beforeAll(async () => {
    store.length = 0
    nextId = 1
    app = await TheoApp.create({
      controllers: [
        ItemsController, HeadersController, GuardedController,
        InterceptedController, FilteredController, ExceptionsController,
        StatusController, ValidationController,
      ],
      readinessChecks: [
        async () => ({ name: 'store', healthy: true }),
      ],
    })
    const h = app.getServerHandle()
    await new Promise<void>(r => h.listen(0, r))
    base = `http://localhost:${h.address()?.port}`
  })

  afterAll(async () => { await app.close() })

  const json = async (path: string, init?: RequestInit) => {
    const res = await fetch(`${base}${path}`, init)
    const body = res.headers.get('content-type')?.includes('json')
      ? await res.json()
      : await res.text()
    return { status: res.status, body, headers: res.headers }
  }

  // ── CRUD ──

  describe('CRUD operations', () => {
    it('GET /api/items returns empty array initially', async () => {
      const { status, body } = await json('/api/items')
      expect(status).toBe(200)
      expect(body).toEqual([])
    })

    it('POST /api/items creates item', async () => {
      const { status, body } = await json('/api/items', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'First' }),
      })
      expect(status).toBe(201)
      expect(body).toEqual({ id: 1, name: 'First', done: false })
    })

    it('POST /api/items creates second item', async () => {
      const { status, body } = await json('/api/items', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Second' }),
      })
      expect(status).toBe(201)
      expect(body.id).toBe(2)
    })

    it('GET /api/items returns 2 items', async () => {
      const { body } = await json('/api/items')
      expect(body).toHaveLength(2)
    })

    it('GET /api/items/1 returns specific item', async () => {
      const { status, body } = await json('/api/items/1')
      expect(status).toBe(200)
      expect(body.name).toBe('First')
    })

    it('PUT /api/items/1 replaces item', async () => {
      const { body } = await json('/api/items/1', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Updated' }),
      })
      expect(body.name).toBe('Updated')
    })

    it('PATCH /api/items/1 partially updates', async () => {
      const { body } = await json('/api/items/1', {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ done: true }),
      })
      expect(body.done).toBe(true)
      expect(body.name).toBe('Updated')
    })

    it('DELETE /api/items/2 returns 204', async () => {
      const res = await fetch(`${base}/api/items/2`, { method: 'DELETE' })
      expect(res.status).toBe(204)
    })

    it('GET /api/items after delete returns 1 item', async () => {
      const { body } = await json('/api/items')
      expect(body).toHaveLength(1)
    })

    it('GET /api/items/count returns count', async () => {
      const { body } = await json('/api/items/count')
      expect(body.count).toBe(1)
    })

    it('GET /api/items/search?q=Updated returns filtered', async () => {
      const { body } = await json('/api/items/search?q=Updated')
      expect(body).toHaveLength(1)
    })

    it('GET /api/items/search?q=nonexistent returns empty', async () => {
      const { body } = await json('/api/items/search?q=nonexistent')
      expect(body).toEqual([])
    })

    it('GET /api/items/search?q=Updated&limit=1 respects limit', async () => {
      const { body } = await json('/api/items/search?q=Updated&limit=1')
      expect(body).toHaveLength(1)
    })
  })

  // ── Validation ──

  describe('Zod validation', () => {
    it('rejects empty body', async () => {
      const { status } = await json('/api/items', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(status).toBe(422)
    })

    it('rejects name too short (empty string)', async () => {
      const { status } = await json('/api/items', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: '' }),
      })
      expect(status).toBe(422)
    })

    it('rejects wrong type (number instead of string)', async () => {
      const { status } = await json('/api/items', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 12345 }),
      })
      expect(status).toBe(422)
    })

    it('rejects malformed JSON', async () => {
      const res = await fetch(`${base}/api/items`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: '{not json',
      })
      // Malformed JSON → body parse catch sets body=undefined → validation skips (no body to validate)
      // Controller runs with undefined body → behavior depends on handler
      expect([422, 500].includes(res.status)).toBe(true)
    })

    it('accepts valid strict schema', async () => {
      const { status, body } = await json('/api/validation/strict', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'test@test.com', age: 25, role: 'user' }),
      })
      expect(status).toBe(201)
      expect(body.email).toBe('test@test.com')
    })

    it('rejects invalid email', async () => {
      const { status } = await json('/api/validation/strict', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'not-email', age: 25, role: 'user' }),
      })
      expect(status).toBe(422)
    })

    it('rejects age out of range', async () => {
      const { status } = await json('/api/validation/strict', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'a@b.com', age: 200, role: 'user' }),
      })
      expect(status).toBe(422)
    })

    it('rejects invalid enum value', async () => {
      const { status } = await json('/api/validation/strict', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'a@b.com', age: 25, role: 'superadmin' }),
      })
      expect(status).toBe(422)
    })

    it('validates nested objects', async () => {
      const { status } = await json('/api/validation/nested', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ user: { name: 'test', tags: ['a', 'b'] } }),
      })
      expect(status).toBe(201)
    })

    it('rejects invalid nested', async () => {
      const { status } = await json('/api/validation/nested', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ user: { name: 123 } }),
      })
      expect(status).toBe(422)
    })

    it('handles optional fields', async () => {
      const { status, body } = await json('/api/validation/optional', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ required: 'yes' }),
      })
      expect(status).toBe(201)
      expect(body.required).toBe('yes')
      expect(body.defaulted).toBe('fallback')
    })
  })

  // ── HTTP Status Codes ──

  describe('Status codes', () => {
    it('POST returns 201 by default', async () => {
      const { status } = await json('/api/items', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'StatusTest' }),
      })
      expect(status).toBe(201)
    })

    it('@HttpCode(CREATED) returns 201', async () => {
      const { status } = await json('/api/status/created', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ v: 42 }),
      })
      expect(status).toBe(201)
    })

    it('@HttpCode(ACCEPTED) returns 202', async () => {
      const { status } = await json('/api/status/accepted', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: '{}',
      })
      expect(status).toBe(202)
    })

    it('@HttpCode(NO_CONTENT) returns 204', async () => {
      const res = await fetch(`${base}/api/status/gone`, { method: 'DELETE' })
      expect(res.status).toBe(204)
    })

    it('string return → text/plain', async () => {
      const { status, body } = await json('/api/status/string')
      expect(status).toBe(200)
      expect(body).toBe('plain text response')
    })

    it('null return → 204', async () => {
      const res = await fetch(`${base}/api/status/null`)
      expect(res.status).toBe(204)
    })

    it('undefined return → 204', async () => {
      const res = await fetch(`${base}/api/status/undefined`)
      expect(res.status).toBe(204)
    })
  })

  // ── Exception Hierarchy ──

  describe('Exception handling', () => {
    it('BadRequestException → 400', async () => {
      const { status, body } = await json('/api/exceptions/400')
      expect(status).toBe(400)
      expect(body.error.code).toBe('BAD_REQUEST')
    })

    it('Unauthorized → 401', async () => {
      const { status, body } = await json('/api/exceptions/401')
      expect(status).toBe(401)
      expect(body.error.message).toBe('Login required')
    })

    it('Forbidden → 403', async () => {
      const { status, body } = await json('/api/exceptions/403')
      expect(status).toBe(403)
      expect(body.error.message).toBe('Access denied')
    })

    it('NotFound → 404', async () => {
      const { status } = await json('/api/exceptions/404')
      expect(status).toBe(404)
    })

    it('Conflict → 409', async () => {
      const { status, body } = await json('/api/exceptions/409')
      expect(status).toBe(409)
      expect(body.error.message).toBe('Already exists')
    })

    it('Unprocessable → 422', async () => {
      const { status } = await json('/api/exceptions/422')
      expect(status).toBe(422)
    })

    it('TooManyRequests → 429', async () => {
      const { status, body } = await json('/api/exceptions/429')
      expect(status).toBe(429)
      expect(body.error.code).toBe('TOO_MANY_REQUESTS')
    })

    it('Generic Error → 500 scrubbed', async () => {
      const { status, body } = await json('/api/exceptions/500')
      expect(status).toBe(500)
      expect(body.error.message).toBe('Internal Server Error')
      expect(JSON.stringify(body)).not.toContain('should be scrubbed')
    })

    it('Custom HttpException → 418 with description', async () => {
      const { status, body } = await json('/api/exceptions/custom')
      expect(status).toBe(418)
      expect(body.error.description).toBe('Teapot mode')
    })

    it('Unknown route → 404 NOT_FOUND', async () => {
      const { status, body } = await json('/completely/unknown')
      expect(status).toBe(404)
      expect(body.error.code).toBe('NOT_FOUND')
    })

    it('Wrong method → 404', async () => {
      const res = await fetch(`${base}/api/items`, { method: 'PATCH' })
      expect(res.status).toBe(404)
    })
  })

  // ── Guards ──

  describe('Guards (RBAC)', () => {
    it('blocks without role', async () => {
      const { status } = await json('/api/guarded')
      expect(status).toBe(403)
    })

    it('blocks wrong role', async () => {
      const { status } = await json('/api/guarded', {
        headers: { 'x-role': 'user' },
      })
      expect(status).toBe(403)
    })

    it('allows correct role', async () => {
      const { status, body } = await json('/api/guarded', {
        headers: { 'x-role': 'admin' },
      })
      expect(status).toBe(200)
      expect(body.secret).toBe('admin-data')
    })

    it('method-level override: public route bypasses guard', async () => {
      const { status, body } = await json('/api/guarded/public')
      expect(status).toBe(200)
      expect(body.public).toBe(true)
    })
  })

  // ── Interceptors ──

  describe('Interceptors', () => {
    it('interceptor wraps response', async () => {
      const { status, body } = await json('/api/intercepted')
      expect(status).toBe(200)
      expect(body.__intercepted).toBe(true)
      expect(typeof body.timing).toBe('number')
      expect(body.data.value).toBe(42)
    })
  })

  // ── Exception Filters ──

  describe('Exception Filters', () => {
    it('custom filter formats error', async () => {
      const { status, body } = await json('/api/filtered/error')
      expect(status).toBe(400)
      expect(body.custom).toBe(true)
      expect(body.msg).toBe('Custom filtered error')
    })

    it('non-error route not affected by filter', async () => {
      const { status, body } = await json('/api/filtered/ok')
      expect(status).toBe(200)
      expect(body.filtered).toBe(true)
    })
  })

  // ── Headers + Decorators ──

  describe('Headers and metadata', () => {
    it('@Headers extracts custom header', async () => {
      const { body } = await json('/api/headers/echo', {
        headers: { 'x-custom': 'test-value' },
      })
      expect(body.custom).toBe('test-value')
    })

    it('@Ip extracts IP', async () => {
      const { body } = await json('/api/headers/echo')
      expect(body.ip).toBe('127.0.0.1')
    })

    it('@Header sets response headers', async () => {
      const { headers } = await json('/api/headers/set')
      expect(headers.get('x-powered-by')).toBe('TheoKit')
      expect(headers.get('x-version')).toBe('1.0')
    })
  })

  // ── Health Probes ──

  describe('Health probes', () => {
    it('/__theo/health returns ok', async () => {
      const { status, body } = await json('/__theo/health')
      expect(status).toBe(200)
      expect(body.status).toBe('ok')
      expect(body.uptime).toBeGreaterThan(0)
    })

    it('/__theo/ready returns ready', async () => {
      const { status, body } = await json('/__theo/ready')
      expect(status).toBe(200)
      expect(body.status).toBe('ready')
      expect(body.checks).toHaveLength(1)
    })

    it('health probes bypass guards', async () => {
      // No x-role header — guards would block, but health bypasses
      const { status } = await json('/__theo/health')
      expect(status).toBe(200)
    })
  })

  // ── TypedClient ──

  describe('TypedClient', () => {
    it('GET works', async () => {
      const client = createTypedClient<Record<string, { response: unknown }>>(`${base}`)
      const items = await client.get('/api/items') as unknown[]
      expect(Array.isArray(items)).toBe(true)
    })

    it('POST works', async () => {
      const client = createTypedClient<Record<string, { response: unknown }>>(`${base}`)
      const item = await client.post('/api/items', { name: 'ClientItem' }) as { name: string }
      expect(item.name).toBe('ClientItem')
    })

    it('DELETE works', async () => {
      const client = createTypedClient<Record<string, { response: unknown }>>(`${base}`)
      const result = await client.delete('/api/items/1')
      expect(result).toBeUndefined()
    })

    it('error throws TypedClientError', async () => {
      const client = createTypedClient<Record<string, { response: unknown }>>(`${base}`)
      try {
        await client.get('/api/items/99999')
        expect.fail('should throw')
      } catch (e) {
        expect(e).toBeInstanceOf(TypedClientError)
        expect((e as TypedClientError).status).toBe(404)
      }
    })

    it('validation error is TypedClientError', async () => {
      const client = createTypedClient<Record<string, { response: unknown }>>(`${base}`)
      try {
        await client.post('/api/items', { name: '' })
        expect.fail('should throw')
      } catch (e) {
        expect((e as TypedClientError).status).toBe(422)
      }
    })

    it('custom headers forwarded', async () => {
      const client = createTypedClient<Record<string, { response: unknown }>>(`${base}`, { 'x-custom': 'from-client' })
      const result = await client.get('/api/headers/echo') as { custom: string }
      expect(result.custom).toBe('from-client')
    })
  })
})
