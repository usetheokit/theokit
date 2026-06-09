/**
 * @theokit/http-decorators — Live Server Demo (pure JS, no transpiler needed)
 *
 * Calls decorator functions imperatively to wire metadata — produces
 * the exact same result as writing @Controller/@Get/@Body in TypeScript.
 *
 * Run: node packages/http-decorators/examples/live-server.mjs
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

// ── DTO with Zod static schema (Pattern D2) ──────────

const zCreateCat = z.object({
  name: z.string().min(1, 'name is required'),
  age: z.number().min(0, 'age must be >= 0'),
  breed: z.string().optional(),
})

class CreateCatDto {
  static schema = zCreateCat
}

// ── Guard ──────────────────────────────────────────────

class ApiKeyGuard {
  canActivate(req) {
    return req.headers['x-api-key'] === 'theokit-secret'
  }
}

// ── In-memory data ─────────────────────────────────────

const cats = [
  { id: 1, name: 'Whiskers', age: 3, breed: 'Siamese' },
  { id: 2, name: 'Shadow', age: 5, breed: 'Persian' },
  { id: 3, name: 'Luna', age: 2 },
]
let nextId = 4

// ── Controller (imperative decorator calls = same as @syntax) ──

class CatsController {
  findAll() {
    return cats
  }
  search(breed) {
    return {
      breed,
      count: cats.filter((c) => c.breed?.toLowerCase() === breed?.toLowerCase()).length,
      results: cats.filter((c) => c.breed?.toLowerCase() === breed?.toLowerCase()),
    }
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
  adminStats() {
    return {
      total: cats.length,
      avgAge: +(cats.reduce((s, c) => s + c.age, 0) / cats.length).toFixed(1),
    }
  }
}

// Wire class decorator: @Controller('cats')
Controller('cats')(CatsController)

// Wire method decorators
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
Get('admin/stats')(
  CatsController.prototype,
  'adminStats',
  Object.getOwnPropertyDescriptor(CatsController.prototype, 'adminStats'),
)
UseGuards(ApiKeyGuard)(CatsController.prototype, 'adminStats')
Header('X-Powered-By', '@theokit/http-decorators')(
  CatsController.prototype,
  'findAll',
  Object.getOwnPropertyDescriptor(CatsController.prototype, 'findAll'),
)

// Wire parameter decorators (what tsc emitDecoratorMetadata + @Body/@Param/@Query produce)
function wireParam(ctrl, method, index, source, key) {
  const map = Reflect.getMetadata(ROUTE_PARAMS, ctrl) ?? new Map()
  const entries = map.get(method) ?? []
  entries.push({ source, key, index })
  map.set(method, entries)
  setMeta(ROUTE_PARAMS, ctrl, map)
}
wireParam(CatsController, 'search', 0, 'query', 'breed')
wireParam(CatsController, 'findOne', 0, 'param', 'id')
wireParam(CatsController, 'create', 0, 'body', undefined)
wireParam(CatsController, 'remove', 0, 'param', 'id')
Reflect.defineMetadata('design:paramtypes', [CreateCatDto], CatsController.prototype, 'create')

// ── Health controller ──────────────────────────────────

class HealthController {
  check() {
    return {
      status: 'ok',
      uptime: process.uptime(),
      package: '@theokit/http-decorators v0.1.0-alpha.0',
    }
  }
}
Controller('health')(HealthController)
Get()(
  HealthController.prototype,
  'check',
  Object.getOwnPropertyDescriptor(HealthController.prototype, 'check'),
)

// ── Boot ───────────────────────────────────────────────

const PORT = 4000
const server = createDecoratorServer([CatsController, HealthController])
server.listen(PORT, () => {
  console.log(`
  @theokit/http-decorators LIVE on http://localhost:${PORT}

  Endpoints:
    GET    /health              → health check
    GET    /cats                → list all (+ X-Powered-By header)
    GET    /cats/search?breed=  → search by breed
    GET    /cats/:id            → get one cat
    POST   /cats                → create (Zod validates body)
    DELETE /cats/:id            → delete (204)
    GET    /cats/admin/stats    → guarded by x-api-key header
  `)
})
