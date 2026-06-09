import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import http from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Controller, Get, UseGuards } from '../../src/index.js'
import { createDecoratorServer } from '../../src/bridge/create-server.js'
import {
  type NestMiddleware,
  MiddlewareConsumerImpl,
} from '../../src/bridge/middleware-consumer.js'

// ─── Middleware ───

const middlewareLog: string[] = []

class LoggerMiddleware implements NestMiddleware {
  use(_req: IncomingMessage, _res: ServerResponse, next: () => void) {
    middlewareLog.push('logger')
    next()
  }
}

function corsMiddleware(_req: IncomingMessage, res: ServerResponse, next: () => void) {
  res.setHeader('X-Cors', 'true')
  middlewareLog.push('cors')
  next()
}

// ─── Guard ───

class AuthGuard {
  canActivate(req: IncomingMessage) {
    return req.headers['x-api-key'] === 'secret'
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

describe('T2.2 — Middleware HTTP roundtrip', () => {
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
        const res = await fetch(`http://localhost:${port}/api/tasks`)
        expect(res.headers.get('x-cors')).toBe('true')
        expect(middlewareLog).toContain('cors')
      },
    )
  })
})
