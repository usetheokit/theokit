import 'reflect-metadata'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Controller } from '../../src/decorators/controller.js'
import { Get } from '../../src/decorators/methods.js'
import { createDecoratorServer, type DiContainer } from '../../src/bridge/create-server.js'

// ── Simulate @theokit/di Container with a minimal structural match ──

class CatsService {
  findAll() {
    return [
      { id: 1, name: 'Whiskers' },
      { id: 2, name: 'Shadow' },
    ]
  }
}

// Controller with constructor injection
@Controller('cats')
class CatsController {
  private catsService: CatsService

  constructor(catsService: CatsService) {
    this.catsService = catsService
  }

  @Get()
  findAll() {
    return this.catsService.findAll()
  }
}

// Minimal DI container that structurally matches @theokit/di Container
class FakeContainer implements DiContainer {
  private registry = new Map<Function, object>()

  register(token: Function, instance: object) {
    this.registry.set(token, instance)
  }

  resolve<T>(token: Function): T {
    // If asking for a class we know, return its instance
    const instance = this.registry.get(token)
    if (instance) return instance as T

    // For controllers: construct with deps resolved from registry
    // This simulates @theokit/di's reflect-metadata-based constructor injection
    const paramTypes: Function[] = Reflect.getMetadata('design:paramtypes', token) ?? []
    const args = paramTypes.map((pt: Function) => {
      const dep = this.registry.get(pt)
      if (!dep) throw new Error(`MissingInjectableError: ${pt.name} not registered`)
      return dep
    })
    return new (token as new (...a: unknown[]) => T)(...args)
  }
}

// Simulate tsc emitDecoratorMetadata — CatsController(CatsService)
Reflect.defineMetadata('design:paramtypes', [CatsService], CatsController)

describe('DI Integration — constructor injection via container', () => {
  let server: ReturnType<typeof createDecoratorServer>
  let port: number

  beforeAll(async () => {
    const container = new FakeContainer()
    container.register(CatsService, new CatsService())

    server = createDecoratorServer({
      controllers: [CatsController],
      container,
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

  it('GET /cats returns data from injected CatsService', async () => {
    const res = await fetch(`http://localhost:${port}/cats`)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toEqual([
      { id: 1, name: 'Whiskers' },
      { id: 2, name: 'Shadow' },
    ])
  })

  it('CatsService.findAll() was called (proves DI wired correctly)', async () => {
    const res = await fetch(`http://localhost:${port}/cats`)
    const data = await res.json()
    // If DI wasn't working, catsService would be undefined → handler would throw
    expect(data.length).toBe(2)
  })
})

describe('DI fallback — works without container (backward compat)', () => {
  it('createDecoratorServer([...]) still works with array syntax', async () => {
    @Controller('health')
    class HealthCtrl {
      @Get()
      check() {
        return { status: 'ok' }
      }
    }

    const server = createDecoratorServer([HealthCtrl])
    await new Promise<void>((r) => server.listen(0, r))
    const port = (server.address() as { port: number }).port

    const res = await fetch(`http://localhost:${port}/health`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })

    server.close()
  })
})
