import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import type { ExecutionContext } from '../../src/bridge/execution-context.js'
import { Controller, Get, UseGuards } from '../../src/index.js'
import { createDecoratorServer } from '../../src/bridge/create-server.js'
import {
  type NestMiddleware,
  type MiddlewareConsumerImpl,
} from '../../src/bridge/middleware-consumer.js'

// Bun lacks emitDecoratorMetadata support (same as esbuild). Tests using
// decorator syntax require SWC compilation provided by vitest. Skip on Bun.
const isVitest = typeof process !== 'undefined' && !!process.env.VITEST

// ─── Middleware ───

const middlewareLog: string[] = []

class LoggerMiddleware implements NestMiddleware {
  use(_request: Request, next: () => Promise<Response | null>) {
    middlewareLog.push('logger')
    return next()
  }
}

function corsMiddleware(_request: Request, next: () => Promise<Response | null>) {
  middlewareLog.push('cors')
  return next()
}

// ─── Guard ───

class AuthGuard {
  canActivate(context: ExecutionContext) {
    const req = context.getRequest()
    return req.headers.get('x-api-key') === 'secret'
  }
}

// ─── Controller ───

@Controller('api/tasks')
class TasksCtrl {
  @Get()
  list() {
    return [{ id: 1 }]
  }

  @Get('admin')
  @UseGuards(AuthGuard)
  admin() {
    return { admin: true }
  }
}

@Controller('api/users')
class UsersCtrl {
  @Get()
  list() {
    return [{ name: 'Alice' }]
  }
}

// ─── Tests ───

describe.skipIf(!isVitest)('T2.2 — Middleware HTTP roundtrip', () => {
  function createServer(configureFn: (c: MiddlewareConsumerImpl) => void) {
    return createDecoratorServer({
      controllers: [TasksCtrl, UsersCtrl],
      configure: configureFn,
    })
  }

  async function withServer(
    configureFn: (c: MiddlewareConsumerImpl) => void,
    fn: (port: number) => Promise<void>,
  ) {
    const server = createServer(configureFn)
    await new Promise<void>((r) => server.listen(0, r))
    const port = (server.address() as { port: number }).port
    try {
      await fn(port)
    } finally {
      server.close()
    }
  }

  it('test_middleware_runs_before_guards', async () => {
    middlewareLog.length = 0
    await withServer(
      (consumer) => {
        consumer.apply(LoggerMiddleware).forRoutes('api/tasks')
      },
      async (port) => {
        // Middleware logs BEFORE guard checks auth
        await fetch(`http://localhost:${port}/api/tasks/admin`)
        expect(middlewareLog).toContain('logger')
      },
    )
  })

  it('test_middleware_filtered_by_route', async () => {
    middlewareLog.length = 0
    await withServer(
      (consumer) => {
        consumer.apply(LoggerMiddleware).forRoutes('api/tasks')
      },
      async (port) => {
        // /api/users should NOT trigger tasks middleware
        await fetch(`http://localhost:${port}/api/users`)
        expect(middlewareLog).toEqual([])

        // /api/tasks SHOULD trigger
        await fetch(`http://localhost:${port}/api/tasks`)
        expect(middlewareLog).toEqual(['logger'])
      },
    )
  })

  it('test_middleware_exclude_works', async () => {
    middlewareLog.length = 0
    await withServer(
      (consumer) => {
        consumer.apply(LoggerMiddleware).exclude('api/tasks/admin').forRoutes('api/tasks')
      },
      async (port) => {
        await fetch(`http://localhost:${port}/api/tasks`)
        expect(middlewareLog).toEqual(['logger'])

        middlewareLog.length = 0
        await fetch(`http://localhost:${port}/api/tasks/admin`)
        expect(middlewareLog).toEqual([]) // excluded
      },
    )
  })

  it('test_functional_middleware_http', async () => {
    middlewareLog.length = 0
    await withServer(
      (consumer) => {
        consumer.apply(corsMiddleware).forRoutes('*')
      },
      async (port) => {
        await fetch(`http://localhost:${port}/api/tasks`)
        expect(middlewareLog).toContain('cors')
      },
    )
  })
})
