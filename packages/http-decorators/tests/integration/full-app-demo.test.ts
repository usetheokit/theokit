/**
 * Full TheoKit App Demo — TypeScript com @syntax real
 *
 * Este teste É o exemplo de como um consumer TheoKit escreve uma app
 * com decorators. Roda via vitest (que suporta experimentalDecorators).
 */
import 'reflect-metadata'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { z } from 'zod'
import type { IncomingMessage } from 'node:http'
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

// ═══════════════════════════════════════════════════════
// Services (@Injectable — lógica de negócio)
// ═══════════════════════════════════════════════════════

class UserService {
  private users = [
    { id: 1, name: 'Paulo', email: 'paulo@theokit.dev', role: 'admin' },
    { id: 2, name: 'Ana', email: 'ana@theokit.dev', role: 'user' },
  ]
  private nextId = 3

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
    return idx !== -1
  }
  stats() {
    return {
      total: this.users.length,
      admins: this.users.filter((u) => u.role === 'admin').length,
    }
  }
}

// ═══════════════════════════════════════════════════════
// DTOs (Zod validation — Pattern D2)
// ═══════════════════════════════════════════════════════

const zCreateUser = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  role: z.enum(['admin', 'user']).default('user'),
})
class CreateUserDto {
  static schema = zCreateUser
}

// ═══════════════════════════════════════════════════════
// Guards
// ═══════════════════════════════════════════════════════

class AuthGuard {
  canActivate(req: IncomingMessage) {
    return req.headers['x-api-key'] === 'secret-key'
  }
}

// ═══════════════════════════════════════════════════════
// Controller — TypeScript com @ syntax REAL
// ═══════════════════════════════════════════════════════

@Controller('users')
class UsersController {
  private userService: UserService

  // Constructor injection — DI resolve CatsService automaticamente
  constructor(userService: UserService) {
    this.userService = userService
  }

  @Get()
  @Header('X-Service', 'users')
  findAll() {
    return this.userService.findAll()
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    const user = this.userService.findById(id)
    return user ?? { error: 'User not found' }
  }

  @Post()
  create(@Body() body: CreateUserDto) {
    return this.userService.create(body as z.infer<typeof zCreateUser>)
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    this.userService.remove(id)
  }

  @Get('stats')
  @UseGuards(AuthGuard)
  getStats() {
    return this.userService.stats()
  }
}

@Controller('health')
class HealthController {
  @Get()
  check() {
    return { status: 'ok', framework: 'TheoKit' }
  }
}

// ═══════════════════════════════════════════════════════
// Wire parameter decorators (vitest/esbuild limitation)
// Em produção com tsc, isso é automático via emitDecoratorMetadata
// ═══════════════════════════════════════════════════════

function wireParam(ctrl: Function, method: string, idx: number, src: string, key?: string) {
  const map = Reflect.getMetadata(ROUTE_PARAMS, ctrl) ?? new Map()
  const entries = map.get(method) ?? []
  entries.push({ source: src, key, index: idx })
  map.set(method, entries)
  setMeta(ROUTE_PARAMS, ctrl, map)
}

wireParam(UsersController, 'findById', 0, 'param', 'id')
wireParam(UsersController, 'create', 0, 'body', undefined)
wireParam(UsersController, 'remove', 0, 'param', 'id')
Reflect.defineMetadata('design:paramtypes', [UserService], UsersController)
Reflect.defineMetadata('design:paramtypes', [CreateUserDto], UsersController.prototype, 'create')

// ═══════════════════════════════════════════════════════
// DI Container (simula @theokit/di Container)
// ═══════════════════════════════════════════════════════

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
    const instance = new (token as new (...a: unknown[]) => T)(...args)
    this.instances.set(token, instance)
    return instance
  }
}

// ═══════════════════════════════════════════════════════
// Tests — prova o full app end-to-end
// ═══════════════════════════════════════════════════════

describe('Full TheoKit App Demo — @syntax TypeScript real', () => {
  let server: ReturnType<typeof createDecoratorServer>
  let port: number

  beforeAll(async () => {
    const container = new SimpleContainer()
    container.register(UserService, new UserService())

    server = createDecoratorServer({
      controllers: [UsersController, HealthController],
      container,
    })

    await new Promise<void>((r) => server.listen(0, r))
    port = (server.address() as { port: number }).port
  })

  afterAll(() => server.close())

  it('GET /health → 200 framework info', async () => {
    const res = await fetch(`http://localhost:${port}/health`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok', framework: 'TheoKit' })
  })

  it('GET /users → 200 list from injected UserService', async () => {
    const res = await fetch(`http://localhost:${port}/users`)
    expect(res.status).toBe(200)
    const data = (await res.json()) as Array<{ name: string }>
    expect(data.length).toBe(2)
    expect(data[0].name).toBe('Paulo')
  })

  it('GET /users/1 → 200 param extraction + DI', async () => {
    const res = await fetch(`http://localhost:${port}/users/1`)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ id: 1, name: 'Paulo', role: 'admin' })
  })

  it('POST /users valid → 201 Zod validated + DI service creates', async () => {
    const res = await fetch(`http://localhost:${port}/users`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Maria', email: 'maria@test.com' }),
    })
    expect(res.status).toBe(201)
    const user = (await res.json()) as { id: number; name: string }
    expect(user.name).toBe('Maria')
    expect(user.id).toBe(3)
  })

  it('POST /users invalid → 422 Zod rejects', async () => {
    const res = await fetch(`http://localhost:${port}/users`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'A', email: 'bad' }),
    })
    expect(res.status).toBe(422)
    const data = (await res.json()) as { error: { code: string } }
    expect(data.error.code).toBe('VALIDATION_ERROR')
  })

  it('DELETE /users/2 → 204', async () => {
    const res = await fetch(`http://localhost:${port}/users/2`, { method: 'DELETE' })
    expect(res.status).toBe(204)
  })

  it('GET /users/stats sem auth → 401', async () => {
    const res = await fetch(`http://localhost:${port}/users/stats`)
    expect(res.status).toBe(401)
  })

  it('GET /users/stats com auth → 200 stats from DI service', async () => {
    const res = await fetch(`http://localhost:${port}/users/stats`, {
      headers: { 'x-api-key': 'secret-key' },
    })
    expect(res.status).toBe(200)
    const stats = (await res.json()) as { total: number; admins: number }
    expect(stats.total).toBeGreaterThanOrEqual(2)
    expect(stats.admins).toBe(1)
  })
})
