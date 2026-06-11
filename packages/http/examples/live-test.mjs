#!/usr/bin/env node
/**
 * @theokit/http-decorators — LIVE TEST
 *
 * Sobe um server HTTP real com CRUD completo + Zod validation + Guards,
 * roda 11 requests automaticamente, e mostra o resultado de cada.
 *
 * Run: node packages/http-decorators/examples/live-test.mjs
 */
import 'reflect-metadata'
import { z } from 'zod'
import {
  Controller,
  Get,
  Post,
  Delete,
  HttpCode,
  Header,
  UseGuards,
  setMeta,
  ROUTE_PARAMS,
  createDecoratorServer,
} from '../dist/index.js'

// ── Setup ──────────────────────────────────────────────

const zCreateCat = z.object({
  name: z.string().min(1, 'name is required'),
  age: z.number().min(0, 'age must be >= 0'),
  breed: z.string().optional(),
})
class CreateCatDto {
  static schema = zCreateCat
}

class ApiKeyGuard {
  canActivate(context) {
    const req = context.getRequest()
    return req.headers.get('x-api-key') === 'theokit-secret'
  }
}

const cats = [
  { id: 1, name: 'Whiskers', age: 3, breed: 'Siamese' },
  { id: 2, name: 'Shadow', age: 5, breed: 'Persian' },
  { id: 3, name: 'Luna', age: 2 },
]
let nextId = 4

// ── Controllers ────────────────────────────────────────

class CatsController {
  findAll() {
    return cats
  }
  search(breed) {
    return cats.filter((c) => c.breed?.toLowerCase() === breed?.toLowerCase())
  }
  findOne(id) {
    return cats.find((c) => c.id === Number(id)) ?? { error: 'not found' }
  }
  create(body) {
    const cat = { id: nextId++, ...body }
    cats.push(cat)
    return cat
  }
  remove(id) {
    const i = cats.findIndex((c) => c.id === Number(id))
    if (i !== -1) cats.splice(i, 1)
  }
  stats() {
    return {
      total: cats.length,
      avgAge: +(cats.reduce((s, c) => s + c.age, 0) / cats.length).toFixed(1),
    }
  }
}

// Wire decorators imperatively (= identical to @syntax compiled by tsc)
Controller('api/cats')(CatsController)
Get()(
  CatsController.prototype,
  'findAll',
  Object.getOwnPropertyDescriptor(CatsController.prototype, 'findAll'),
)
Get('search')(
  CatsController.prototype,
  'search',
  Object.getOwnPropertyDescriptor(CatsController.prototype, 'search'),
)
Get(':id')(
  CatsController.prototype,
  'findOne',
  Object.getOwnPropertyDescriptor(CatsController.prototype, 'findOne'),
)
Post()(
  CatsController.prototype,
  'create',
  Object.getOwnPropertyDescriptor(CatsController.prototype, 'create'),
)
Delete(':id')(
  CatsController.prototype,
  'remove',
  Object.getOwnPropertyDescriptor(CatsController.prototype, 'remove'),
)
HttpCode(204)(
  CatsController.prototype,
  'remove',
  Object.getOwnPropertyDescriptor(CatsController.prototype, 'remove'),
)
Get('stats')(
  CatsController.prototype,
  'stats',
  Object.getOwnPropertyDescriptor(CatsController.prototype, 'stats'),
)
UseGuards(ApiKeyGuard)(CatsController.prototype, 'stats')
Header('X-Powered-By', '@theokit/http-decorators')(
  CatsController.prototype,
  'findAll',
  Object.getOwnPropertyDescriptor(CatsController.prototype, 'findAll'),
)

// Wire params
function wp(ctrl, method, idx, src, key) {
  const map = Reflect.getMetadata(ROUTE_PARAMS, ctrl) ?? new Map()
  const entries = map.get(method) ?? []
  entries.push({ source: src, key, index: idx })
  map.set(method, entries)
  setMeta(ROUTE_PARAMS, ctrl, map)
}
wp(CatsController, 'search', 0, 'query', 'breed')
wp(CatsController, 'findOne', 0, 'param', 'id')
wp(CatsController, 'create', 0, 'body', undefined)
wp(CatsController, 'remove', 0, 'param', 'id')
Reflect.defineMetadata('design:paramtypes', [CreateCatDto], CatsController.prototype, 'create')

class HealthController {
  check() {
    return { status: 'ok', package: '@theokit/http-decorators v0.1.0-alpha.0' }
  }
}
Controller('health')(HealthController)
Get()(
  HealthController.prototype,
  'check',
  Object.getOwnPropertyDescriptor(HealthController.prototype, 'check'),
)

// ── Boot + Test ────────────────────────────────────────

const server = createDecoratorServer([CatsController, HealthController])

await new Promise((r) => server.listen(0, r))
const port = server.address().port
const BASE = `http://localhost:${port}`

let pass = 0,
  fail = 0

async function test(name, url, opts, expectStatus, expectBodyCheck) {
  try {
    const res = await fetch(`${BASE}${url}`, opts)
    const status = res.status
    let body = null
    if (status !== 204) {
      const ct = res.headers.get('content-type') ?? ''
      if (ct.includes('json')) body = await res.json()
      else if (ct.includes('text')) body = await res.text()
    }

    const statusOk = status === expectStatus
    const bodyOk = expectBodyCheck ? expectBodyCheck(body, res) : true
    const ok = statusOk && bodyOk

    if (ok) {
      pass++
      console.log(
        `  ✅ ${name}  →  ${status}  ${body ? JSON.stringify(body).slice(0, 80) : '(empty)'}`,
      )
    } else {
      fail++
      console.log(
        `  ❌ ${name}  →  ${status} (expected ${expectStatus})  ${JSON.stringify(body).slice(0, 80)}`,
      )
    }
  } catch (err) {
    fail++
    console.log(`  ❌ ${name}  →  ERROR: ${err.message}`)
  }
}

console.log(`\n  @theokit/http-decorators — Live Test on port ${port}\n`)
console.log('  ─────────────────────────────────────────────────')

await test('GET /health', '/health', {}, 200, (b) => b.status === 'ok')

await test('GET /api/cats (list)', '/api/cats', {}, 200, (b) => Array.isArray(b) && b.length === 3)

await test(
  'GET /api/cats/search?breed=siamese',
  '/api/cats/search?breed=siamese',
  {},
  200,
  (b) => Array.isArray(b) && b[0]?.name === 'Whiskers',
)

await test(
  'GET /api/cats/1 (param)',
  '/api/cats/1',
  {},
  200,
  (b) => b.id === 1 && b.name === 'Whiskers',
)

await test(
  'POST /api/cats valid body → 201',
  '/api/cats',
  {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Mittens', age: 1, breed: 'Tabby' }),
  },
  201,
  (b) => b.name === 'Mittens' && b.id === 4,
)

await test(
  'POST /api/cats INVALID → 422 Zod',
  '/api/cats',
  {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: '', age: -1 }),
  },
  422,
  (b) => b.error?.code === 'VALIDATION_ERROR' && b.error.issues.length >= 2,
)

await test('DELETE /api/cats/2 → 204', '/api/cats/2', { method: 'DELETE' }, 204)

await test(
  'GET /api/cats after delete (3 items)',
  '/api/cats',
  {},
  200,
  (b) => Array.isArray(b) && b.length === 3 && !b.find((c) => c.id === 2),
)

await test(
  'GET /api/cats/stats sem key → 403',
  '/api/cats/stats',
  {},
  403,
  (b) => b.error?.code === 'FORBIDDEN',
)

await test(
  'GET /api/cats/stats com key → 200',
  '/api/cats/stats',
  { headers: { 'x-api-key': 'theokit-secret' } },
  200,
  (b) => typeof b.total === 'number' && typeof b.avgAge === 'number',
)

await test('GET /nao-existe → 404', '/nao-existe', {}, 404, (b) => b.error?.code === 'NOT_FOUND')

console.log('\n  ─────────────────────────────────────────────────')
console.log(`  Results: ${pass} passed, ${fail} failed, ${pass + fail} total`)
console.log(`  Verdict: ${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES DETECTED'}\n`)

server.close()
process.exit(fail > 0 ? 1 : 0)
