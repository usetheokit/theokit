/**
 * Live Server — TypeScript com @ syntax REAL
 *
 * Sobe um server HTTP e MANTÉM VIVO até SIGINT (Ctrl+C).
 * Roda via: pnpm --filter @theokit/http exec vitest run tests/integration/live-server.test.ts
 *
 * Depois abre outro terminal e faz:
 *   curl localhost:3333/users
 *   curl -X POST localhost:3333/users -H "Content-Type: application/json" -d '{"name":"Maria","email":"maria@test.com"}'
 *   curl localhost:3333/users/stats -H "x-api-key: secret"
 */
import 'reflect-metadata'
import { describe, it } from 'vitest'
import { z } from 'zod'
import type { ExecutionContext } from '../../src/bridge/execution-context.js'
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
} from '../../src/index.js'

// ── Services ───────────────────────────────────────────

class UserService {
  private users = [
    { id: 1, name: 'Paulo', email: 'paulo@theokit.dev', role: 'admin' },
    { id: 2, name: 'Ana', email: 'ana@theokit.dev', role: 'user' },
    { id: 3, name: 'Carlos', email: 'carlos@theokit.dev', role: 'user' },
  ]
  private nextId = 4

  findAll() {
    return this.users
  }
  findById(id: string) {
    return this.users.find((u) => u.id === Number(id)) ?? null
  }
  create(data: { name: string; email: string; role?: string }) {
    const user = { id: this.nextId++, ...data, role: data.role ?? 'user' }
    this.users.push(user)
    return user
  }
  remove(id: string) {
    const idx = this.users.findIndex((u) => u.id === Number(id))
    if (idx !== -1) this.users.splice(idx, 1)
  }
  stats() {
    return { total: this.users.length, admins: this.users.filter((u) => u.role === 'admin').length }
  }
}

class ProductService {
  private products = [
    { id: 1, name: 'TheoKit Pro', price: 99.99 },
    { id: 2, name: 'TheoKit Enterprise', price: 299.99 },
    { id: 3, name: 'TheoKit Starter', price: 0 },
  ]

  findAll() {
    return this.products
  }
  search(q: string) {
    return this.products.filter((p) => p.name.toLowerCase().includes((q ?? '').toLowerCase()))
  }
}

// ── DTOs ───────────────────────────────────────────────

const zCreateUser = z.object({
  name: z.string().min(2, 'Nome mínimo 2 chars'),
  email: z.string().email('Email inválido'),
  role: z.enum(['admin', 'user']).default('user'),
})
class CreateUserDto {
  static schema = zCreateUser
}

// ── Guards ─────────────────────────────────────────────

class AuthGuard {
  canActivate(context: ExecutionContext) {
    const req = context.getRequest()
    return req.headers.get('x-api-key') === 'secret'
  }
}

// ── Controllers — TypeScript @ syntax REAL ─────────────

@Controller('users')
class UsersController {
  private svc: UserService
  constructor(svc: UserService) {
    this.svc = svc
  }

  @Get()
  @Header('X-Powered-By', '@theokit/http')
  findAll() {
    return this.svc.findAll()
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.svc.findById(id) ?? { error: 'not found' }
  }

  @Post()
  create(@Body() body: CreateUserDto) {
    return this.svc.create(body as z.infer<typeof zCreateUser>)
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    this.svc.remove(id)
  }

  @Get('stats')
  @UseGuards(AuthGuard)
  getStats() {
    return this.svc.stats()
  }
}

@Controller('products')
class ProductsController {
  private svc: ProductService
  constructor(svc: ProductService) {
    this.svc = svc
  }

  @Get()
  findAll() {
    return this.svc.findAll()
  }

  @Get('search')
  search(@Query('q') q: string) {
    return this.svc.search(q)
  }
}

@Controller('health')
class HealthController {
  @Get()
  check() {
    return { status: 'ok', framework: 'TheoKit', package: '@theokit/http' }
  }
}

// Wire params (vitest/esbuild limitation — tsc does this automatically)
function wp(ctrl: Function, method: string, idx: number, src: string, key?: string) {
  const map = Reflect.getMetadata(ROUTE_PARAMS, ctrl) ?? new Map()
  const entries = map.get(method) ?? []
  entries.push({ source: src, key, index: idx })
  map.set(method, entries)
  setMeta(ROUTE_PARAMS, ctrl, map)
}
wp(UsersController, 'findById', 0, 'param', 'id')
wp(UsersController, 'create', 0, 'body', undefined)
wp(UsersController, 'remove', 0, 'param', 'id')
wp(ProductsController, 'search', 0, 'query', 'q')
Reflect.defineMetadata('design:paramtypes', [UserService], UsersController)
Reflect.defineMetadata('design:paramtypes', [CreateUserDto], UsersController.prototype, 'create')
Reflect.defineMetadata('design:paramtypes', [ProductService], ProductsController)

// ── DI Container ───────────────────────────────────────

class SimpleContainer implements DiContainer {
  private instances = new Map<Function, object>()
  register(token: Function, instance: object) {
    this.instances.set(token, instance)
  }
  resolve<T>(token: Function): T {
    const existing = this.instances.get(token)
    if (existing) return existing as T
    const paramTypes: Function[] = Reflect.getMetadata('design:paramtypes', token) ?? []
    const args = paramTypes.map((pt: Function) => {
      const dep = this.instances.get(pt)
      if (!dep) throw new Error(`DI: ${pt.name} not registered`)
      return dep
    })
    const inst = new (token as new (...a: unknown[]) => T)(...args)
    this.instances.set(token, inst)
    return inst
  }
}

// ── Boot ───────────────────────────────────────────────

describe('LIVE SERVER (TypeScript @ syntax)', () => {
  it('boots and runs automated tests, then prints curl commands', async () => {
    const container = new SimpleContainer()
    container.register(UserService, new UserService())
    container.register(ProductService, new ProductService())

    const server = createDecoratorServer({
      controllers: [UsersController, ProductsController, HealthController],
      container,
    })

    await new Promise<void>((r) => server.listen(3333, r))
    const B = 'http://localhost:3333'

    console.log('\n  🚀 Server UP at http://localhost:3333\n')

    // Auto-test
    const tests: Array<{
      name: string
      url: string
      opts?: RequestInit
      expect: { status: number; check?: (d: unknown) => boolean }
    }> = [
      {
        name: 'GET /health',
        url: '/health',
        expect: { status: 200, check: (d: unknown) => (d as { status: string }).status === 'ok' },
      },
      {
        name: 'GET /users',
        url: '/users',
        expect: {
          status: 200,
          check: (d: unknown) => Array.isArray(d) && (d as unknown[]).length === 3,
        },
      },
      {
        name: 'GET /users/1',
        url: '/users/1',
        expect: { status: 200, check: (d: unknown) => (d as { name: string }).name === 'Paulo' },
      },
      {
        name: 'POST /users valid',
        url: '/users',
        opts: {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Maria', email: 'maria@t.com' }),
        },
        expect: { status: 201, check: (d: unknown) => (d as { name: string }).name === 'Maria' },
      },
      {
        name: 'POST /users invalid',
        url: '/users',
        opts: {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: '', email: 'x' }),
        },
        expect: { status: 422 },
      },
      {
        name: 'DELETE /users/2',
        url: '/users/2',
        opts: { method: 'DELETE' },
        expect: { status: 204 },
      },
      { name: 'GET /users/stats no-auth', url: '/users/stats', expect: { status: 403 } },
      {
        name: 'GET /users/stats auth',
        url: '/users/stats',
        opts: { headers: { 'x-api-key': 'secret' } },
        expect: { status: 200 },
      },
      {
        name: 'GET /products',
        url: '/products',
        expect: {
          status: 200,
          check: (d: unknown) => Array.isArray(d) && (d as unknown[]).length === 3,
        },
      },
      {
        name: 'GET /products/search?q=pro',
        url: '/products/search?q=pro',
        expect: {
          status: 200,
          check: (d: unknown) => Array.isArray(d) && (d as unknown[]).length === 1,
        },
      },
      { name: 'GET /nope', url: '/nope', expect: { status: 404 } },
    ]

    let pass = 0
    for (const t of tests) {
      const res = await fetch(`${B}${t.url}`, t.opts)
      const ok = res.status === t.expect.status
      let data: unknown = null
      if (res.status !== 204) {
        try {
          data = await res.json()
        } catch {
          data = await res.text()
        }
      }
      const bodyOk = t.expect.check ? t.expect.check(data) : true
      if (ok && bodyOk) {
        pass++
        console.log(`  ✅ ${t.name} → ${res.status}`)
      } else {
        console.log(`  ❌ ${t.name} → ${res.status} (expected ${t.expect.status})`)
      }
    }

    console.log(`\n  Results: ${pass}/${tests.length} passed`)
    console.log(`\n  📋 Try these in another terminal:`)
    console.log(`     curl localhost:3333/health`)
    console.log(`     curl localhost:3333/users`)
    console.log(`     curl localhost:3333/users/1`)
    console.log(
      `     curl -X POST localhost:3333/users -H "Content-Type: application/json" -d '{"name":"Test","email":"test@t.com"}'`,
    )
    console.log(`     curl localhost:3333/products/search?q=starter`)
    console.log(`     curl localhost:3333/users/stats -H "x-api-key: secret"`)
    console.log('')

    server.close()
  })
})
