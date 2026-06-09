/**
 * server/main.ts — Application bootstrap
 *
 * This is equivalent to NestJS's main.ts:
 *   const app = await NestFactory.create(AppModule)
 *   await app.listen(3000)
 *
 * TheoKit equivalent:
 *   const server = createDecoratorServer({ controllers, container })
 *   server.listen(3000)
 */
import 'reflect-metadata'
import { createDecoratorServer, type DiContainer } from '@theokit/http-decorators'

import { TasksController } from './controllers/tasks.controller.js'
import { HealthController } from './controllers/health.controller.js'
import { TaskService } from './services/task.service.js'

// ── DI Container setup ────────────────────────────────
// In production: import { Container } from '@theokit/di'
// const container = new Container()
// container.register(TaskService)
// container.registerModule(AppModule)

class AppContainer implements DiContainer {
  private instances = new Map<Function, object>()

  register(token: Function, instance: object) {
    this.instances.set(token, instance)
  }

  resolve<T>(token: Function): T {
    const existing = this.instances.get(token)
    if (existing) return existing as T

    // Auto-resolve with constructor injection
    const paramTypes: Function[] = Reflect.getMetadata('design:paramtypes', token) ?? []
    const args = paramTypes.map((pt: Function) => {
      const dep = this.instances.get(pt)
      if (!dep) throw new Error(`[DI] ${pt.name} not registered — add it to container.register()`)
      return dep
    })
    const instance = new (token as new (...a: unknown[]) => T)(...args)
    this.instances.set(token, instance)
    return instance
  }
}

const container = new AppContainer()
container.register(TaskService, new TaskService())

// ── Boot server ───────────────────────────────────────

const PORT = Number(process.env.PORT ?? 3000)

const server = createDecoratorServer({
  controllers: [TasksController, HealthController],
  container,
})

server.listen(PORT, () => {
  console.log(`
  ┌─────────────────────────────────────────────────┐
  │                                                 │
  │   TheoKit Decorator App                         │
  │   http://localhost:${PORT}                        │
  │                                                 │
  │   Endpoints:                                    │
  │     GET    /health          health check         │
  │     GET    /tasks           list tasks            │
  │     GET    /tasks/search?q= search                │
  │     GET    /tasks/:id       get by id             │
  │     POST   /tasks           create (Zod)          │
  │     POST   /tasks/:id/complete  mark done         │
  │     DELETE /tasks/:id       delete (204)          │
  │     GET    /tasks/stats     stats (auth)          │
  │                                                 │
  │   Auth: Authorization: Bearer theokit-token     │
  │                                                 │
  └─────────────────────────────────────────────────┘
  `)
})
