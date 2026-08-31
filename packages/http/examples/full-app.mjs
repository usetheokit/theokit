#!/usr/bin/env node
/**
 * @theokit/http-decorators — Full App Demo
 *
 * Simulates a complete TheoKit app with:
 *   ✅ Controllers com @Controller/@Get/@Post/@Delete
 *   ✅ DTOs with Zod validation (Pattern D2 — static schema)
 *   ✅ Guards with @UseGuards (API-key authentication)
 *   ✅ DI container com constructor injection (@Injectable + Container)
 *   [x] Multiple controllers (Users + Products + Health)
 *   ✅ Full CRUD (Create, Read, Update, Delete)
 *   [x] Typed parameters (@Param, @Query, @Body)
 *   ✅ Custom status codes (@HttpCode)
 *   ✅ Custom headers (@Header)
 *
 * Run:  node packages/http-decorators/examples/full-app.mjs
 * Test: curl http://localhost:4000/api/health
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
  Public,
  setMeta,
  ROUTE_PARAMS,
  createDecoratorServer,
} from '../dist/index.js'

// ═══════════════════════════════════════════════════════
// LAYER 1 — Services (@Injectable — business logic)
// ═══════════════════════════════════════════════════════

class UserService {
  #users = [
    { id: 1, name: 'Paulo', email: 'paulo@theokit.dev', role: 'admin' },
    { id: 2, name: 'Ana', email: 'ana@theokit.dev', role: 'user' },
    { id: 3, name: 'Carlos', email: 'carlos@theokit.dev', role: 'user' },
  ]
  #nextId = 4

  findAll() {
    return this.#users
  }
  findById(id) {
    return this.#users.find((u) => u.id === Number(id)) ?? null
  }
  create(data) {
    const u = { id: this.#nextId++, ...data }
    this.#users.push(u)
    return u
  }
  remove(id) {
    const i = this.#users.findIndex((u) => u.id === Number(id))
    if (i !== -1) this.#users.splice(i, 1)
    return i !== -1
  }
  countByRole(role) {
    return this.#users.filter((u) => u.role === role).length
  }
}

class ProductService {
  #products = [
    { id: 1, name: 'TheoKit Pro', price: 99.99, stock: 100 },
    { id: 2, name: 'TheoKit Enterprise', price: 299.99, stock: 50 },
    { id: 3, name: 'TheoKit Starter', price: 0, stock: 999 },
  ]
  #nextId = 4

  findAll() {
    return this.#products
  }
  findById(id) {
    return this.#products.find((p) => p.id === Number(id)) ?? null
  }
  search(q) {
    return this.#products.filter((p) => p.name.toLowerCase().includes((q ?? '').toLowerCase()))
  }
  create(data) {
    const p = { id: this.#nextId++, ...data }
    this.#products.push(p)
    return p
  }
  remove(id) {
    const i = this.#products.findIndex((p) => p.id === Number(id))
    if (i !== -1) this.#products.splice(i, 1)
    return i !== -1
  }
}

// ═══════════════════════════════════════════════════════
// LAYER 2 — Guards (authentication/authorization)
// ═══════════════════════════════════════════════════════

class ApiKeyGuard {
  canActivate(context) {
    const req = context.getRequest()
    return req.headers.get('x-api-key') === 'theokit-2026'
  }
}

class AdminGuard {
  canActivate(context) {
    const req = context.getRequest()
    return req.headers.get('x-role') === 'admin'
  }
}

// ═══════════════════════════════════════════════════════
// LAYER 3 — DTOs (Zod validation — Pattern D2)
// ═══════════════════════════════════════════════════════

const zCreateUser = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email'),
  role: z.enum(['admin', 'user']).default('user'),
})
class CreateUserDto {
  static schema = zCreateUser
}

const zCreateProduct = z.object({
  name: z.string().min(1, 'Name is required'),
  price: z.number().min(0, 'Price cannot be negative'),
  stock: z.number().int().min(0, 'Stock cannot be negative'),
})
class CreateProductDto {
  static schema = zCreateProduct
}

// ═══════════════════════════════════════════════════════
// LAYER 4 — Controllers (HTTP endpoints)
// ═══════════════════════════════════════════════════════

// --- DI Container (simulates @theokit/di) ---
const userService = new UserService()
const productService = new ProductService()

const diRegistry = new Map()
diRegistry.set(UserService, userService)
diRegistry.set(ProductService, productService)

const container = {
  resolve(token) {
    const instance = diRegistry.get(token)
    if (instance) return instance
    // Auto-resolve controller with constructor injection
    const paramTypes = Reflect.getMetadata('design:paramtypes', token) ?? []
    const args = paramTypes.map((pt) => {
      const dep = diRegistry.get(pt)
      if (!dep) throw new Error(`DI: ${pt.name} not registered`)
      return dep
    })
    const ctrl = new token(...args)
    diRegistry.set(token, ctrl) // singleton
    return ctrl
  },
}

// ── UsersController ────────────────────────────────────

class UsersController {
  constructor(userService) {
    this.userService = userService
  }
  findAll() {
    return this.userService.findAll()
  }
  findById(id) {
    const u = this.userService.findById(id)
    return u ?? { error: 'User not found' }
  }
  create(body) {
    return this.userService.create(body)
  }
  remove(id) {
    this.userService.remove(id)
  }
  stats() {
    return {
      total: this.userService.findAll().length,
      admins: this.userService.countByRole('admin'),
      users: this.userService.countByRole('user'),
    }
  }
}

Controller('api/users')(UsersController)
Get()(UsersController.prototype, 'findAll')
Get(':id')(UsersController.prototype, 'findById')
Post()(UsersController.prototype, 'create')
Delete(':id')(UsersController.prototype, 'remove')
HttpCode(204)(UsersController.prototype, 'remove')
Get('stats')(UsersController.prototype, 'stats')
// The routes nobody guards are open on purpose, and say so: since usetheokit/theokit#576 a route
// that declares neither a guard nor `@Public()` is refused with 403 rather than served.
for (const m of ['findAll', 'findById', 'create', 'remove']) {
  Public()(UsersController.prototype, m)
}
UseGuards(ApiKeyGuard)(UsersController.prototype, 'stats')
UseGuards(AdminGuard)(UsersController.prototype, 'stats')
Header('X-Service', 'users')(UsersController.prototype, 'findAll')

// Wire params
function wp(ctrl, method, idx, src, key) {
  const map = Reflect.getMetadata(ROUTE_PARAMS, ctrl) ?? new Map()
  const entries = map.get(method) ?? []
  entries.push({ source: src, key, index: idx })
  map.set(method, entries)
  setMeta(ROUTE_PARAMS, ctrl, map)
}
wp(UsersController, 'findById', 0, 'param', 'id')
wp(UsersController, 'create', 0, 'body', undefined)
wp(UsersController, 'remove', 0, 'param', 'id')
Reflect.defineMetadata('design:paramtypes', [UserService], UsersController)
Reflect.defineMetadata('design:paramtypes', [CreateUserDto], UsersController.prototype, 'create')

// ── ProductsController ─────────────────────────────────

class ProductsController {
  constructor(productService) {
    this.productService = productService
  }
  findAll() {
    return this.productService.findAll()
  }
  search(q) {
    return this.productService.search(q)
  }
  findById(id) {
    const p = this.productService.findById(id)
    return p ?? { error: 'Product not found' }
  }
  create(body) {
    return this.productService.create(body)
  }
  remove(id) {
    this.productService.remove(id)
  }
}

Controller('api/products')(ProductsController)
Get()(ProductsController.prototype, 'findAll')
Get('search')(ProductsController.prototype, 'search')
Get(':id')(ProductsController.prototype, 'findById')
Post()(ProductsController.prototype, 'create')
Delete(':id')(ProductsController.prototype, 'remove')
HttpCode(204)(ProductsController.prototype, 'remove')
for (const m of ['findAll', 'search', 'findById', 'remove']) {
  Public()(ProductsController.prototype, m)
}
UseGuards(ApiKeyGuard)(ProductsController.prototype, 'create')

wp(ProductsController, 'search', 0, 'query', 'q')
wp(ProductsController, 'findById', 0, 'param', 'id')
wp(ProductsController, 'create', 0, 'body', undefined)
wp(ProductsController, 'remove', 0, 'param', 'id')
Reflect.defineMetadata('design:paramtypes', [ProductService], ProductsController)
Reflect.defineMetadata(
  'design:paramtypes',
  [CreateProductDto],
  ProductsController.prototype,
  'create',
)

// ── HealthController ───────────────────────────────────

class HealthController {
  check() {
    return {
      status: 'ok',
      uptime: process.uptime(),
      framework: 'TheoKit',
      package: '@theokit/http-decorators v0.1.0-alpha.0',
      features: ['decorators', 'DI', 'guards', 'Zod validation', 'typed client bridge'],
      timestamp: new Date().toISOString(),
    }
  }
}
Controller('api/health')(HealthController)
Public()(HealthController)
Get()(HealthController.prototype, 'check')

// ═══════════════════════════════════════════════════════
// BOOT — createDecoratorServer com DI container
// ═══════════════════════════════════════════════════════

const PORT = 4000
const server = createDecoratorServer({
  controllers: [UsersController, ProductsController, HealthController],
  container,
})

server.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════════════════════════╗
  ║     TheoKit Full-Stack App — @theokit/http-decorators     ║
  ║     http://localhost:${PORT}                                 ║
  ╠═══════════════════════════════════════════════════════════╣
  ║                                                           ║
  ║  🏥 Health:                                                ║
  ║    GET  /api/health                                       ║
  ║                                                           ║
  ║  👤 Users (DI: UserService injected):                      ║
  ║    GET  /api/users              ← list all                ║
  ║    GET  /api/users/:id          ← get by id               ║
  ║    POST /api/users              ← create (Zod validates)  ║
  ║    DEL  /api/users/:id          ← delete (204)            ║
  ║    GET  /api/users/stats        ← admin only (2 guards)   ║
  ║                                                           ║
  ║  📦 Products (DI: ProductService injected):                ║
  ║    GET  /api/products           ← list all                ║
  ║    GET  /api/products/search?q= ← search by name          ║
  ║    GET  /api/products/:id       ← get by id               ║
  ║    POST /api/products           ← create (API key guard)  ║
  ║    DEL  /api/products/:id       ← delete (204)            ║
  ║                                                           ║
  ║  🔑 Auth: x-api-key: theokit-2026                         ║
  ║  👑 Admin: x-role: admin (+ api key)                       ║
  ║                                                           ║
  ║  Quick test:                                              ║
  ║    curl localhost:${PORT}/api/health                         ║
  ║    curl localhost:${PORT}/api/users                          ║
  ║    curl localhost:${PORT}/api/products/search?q=pro          ║
  ║    curl -X POST localhost:${PORT}/api/users \\                ║
  ║      -H "Content-Type: application/json" \\                ║
  ║      -d '{"name":"Maria","email":"maria@test.com"}'       ║
  ║    curl localhost:${PORT}/api/users/stats \\                  ║
  ║      -H "x-api-key: theokit-2026" -H "x-role: admin"     ║
  ║                                                           ║
  ╚═══════════════════════════════════════════════════════════╝
  `)
})
