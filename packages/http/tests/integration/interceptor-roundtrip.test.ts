import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import type { ServerHandle } from '../../src/runtime-node.js'
import { Controller, Get, Post, Body, UseInterceptors, UseGuards } from '../../src/index.js'
import { createDecoratorServer } from '../../src/bridge/create-server.js'
import type { Interceptor } from '../../src/bridge/interceptor-chain.js'
import type { ExecutionContext } from '../../src/bridge/execution-context.js'
import { z } from 'zod'

// Bun lacks emitDecoratorMetadata support (same as esbuild). Tests using
// decorator syntax require SWC compilation provided by vitest. Skip on Bun.
const isVitest = typeof process !== 'undefined' && !!process.env.VITEST

// ─── Interceptors ───

const interceptorLog: string[] = []

class TimingInterceptor implements Interceptor {
  async intercept(_req: Request, next: () => Promise<unknown>) {
    const _start = Date.now()
    const result = await next()
    interceptorLog.push('timing')
    return result
  }
}

class WrapInterceptor implements Interceptor {
  async intercept(_req: Request, next: () => Promise<unknown>) {
    const result = await next()
    interceptorLog.push('wrap')
    return { data: result, wrapped: true }
  }
}

// ─── Guard ───

class AuthGuard {
  canActivate(context: ExecutionContext) {
    const req = context.getRequest()
    return req.headers.get('x-api-key') === 'secret'
  }
}

// ─── Controller ───

const schema = z.object({ name: z.string() })

@UseInterceptors(TimingInterceptor)
@Controller('items')
class ItemsController {
  @Get()
  list() {
    return [{ id: 1 }]
  }

  @Post()
  @UseInterceptors(WrapInterceptor)
  create(@Body(schema) body: z.infer<typeof schema>) {
    return { id: 2, ...body }
  }

  @Get('protected')
  @UseGuards(AuthGuard)
  @UseInterceptors(WrapInterceptor)
  protectedRoute() {
    return { secret: true }
  }
}

// ─── Tests ───

describe.skipIf(!isVitest)('T1.2 — Interceptor HTTP roundtrip', () => {
  let server: ServerHandle
  let port: number

  async function startServer() {
    server = createDecoratorServer([ItemsController])
    await new Promise<void>((r) => server.listen(0, r))
    port = (server.address() as { port: number }).port
  }

  async function fetchJSON(path: string, opts?: RequestInit) {
    const res = await fetch(`http://localhost:${port}${path}`, opts)
    const body = res.headers.get('content-type')?.includes('json') ? await res.json() : null
    return { status: res.status, body, headers: res.headers }
  }

  it('test_interceptor_executes_on_http_request', async () => {
    interceptorLog.length = 0
    await startServer()
    try {
      const { status } = await fetchJSON('/items')
      expect(status).toBe(200)
      // TimingInterceptor runs (no longer sets response headers directly)
      expect(interceptorLog).toContain('timing')
    } finally {
      server.close()
    }
  })

  it('test_interceptor_transforms_response', async () => {
    interceptorLog.length = 0
    await startServer()
    try {
      const { status, body } = await fetchJSON('/items', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'test' }),
      })
      expect(status).toBe(201)
      // POST has both class-level TimingInterceptor + method-level WrapInterceptor
      // WrapInterceptor wraps result in { data, wrapped }
      expect(body.wrapped).toBe(true)
      expect(body.data.name).toBe('test')
    } finally {
      server.close()
    }
  })

  it('test_class_and_method_interceptors_compose', async () => {
    interceptorLog.length = 0
    await startServer()
    try {
      await fetchJSON('/items', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'compose' }),
      })
      // Class-level TimingInterceptor runs OUTER (first), method-level WrapInterceptor runs INNER
      // Onion: timing-before → wrap-before → handler → wrap-after → timing-after
      // So log order: wrap first (inner resolves first), then timing
      expect(interceptorLog).toEqual(['wrap', 'timing'])
    } finally {
      server.close()
    }
  })

  it('test_interceptor_with_guard_order', async () => {
    interceptorLog.length = 0
    await startServer()
    try {
      // Without auth → guard rejects BEFORE interceptors run
      const noAuth = await fetchJSON('/items/protected')
      expect(noAuth.status).toBe(403)
      expect(interceptorLog).toEqual([]) // interceptors never ran

      // With auth → guard passes, interceptors run
      const withAuth = await fetchJSON('/items/protected', {
        headers: { 'x-api-key': 'secret' },
      })
      expect(withAuth.status).toBe(200)
      expect(withAuth.body.wrapped).toBe(true)
      expect(interceptorLog).toContain('timing')
      expect(interceptorLog).toContain('wrap')
    } finally {
      server.close()
    }
  })
})
