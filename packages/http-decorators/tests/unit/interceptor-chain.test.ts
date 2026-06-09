import 'reflect-metadata'
import { describe, it, expect, vi } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { runInterceptors, type Interceptor } from '../../src/bridge/interceptor-chain.js'

// Minimal req/res stubs
const fakeReq = {} as IncomingMessage
const fakeRes = { setHeader: vi.fn() } as unknown as ServerResponse

describe('T1.1 — Interceptor chain runner', () => {
  it('test_single_interceptor_wraps_handler', async () => {
    const log: string[] = []
    class LogInterceptor implements Interceptor {
      async intercept(_req: IncomingMessage, _res: ServerResponse, next: () => Promise<unknown>) {
        log.push('before')
        const result = await next()
        log.push('after')
        return result
      }
    }
    const handler = async () => {
      log.push('handler')
      return { ok: true }
    }

    const result = await runInterceptors([LogInterceptor], handler, fakeReq, fakeRes)

    expect(log).toEqual(['before', 'handler', 'after'])
    expect(result).toEqual({ ok: true })
  })

  it('test_multiple_interceptors_onion_order', async () => {
    const log: string[] = []

    class OuterInterceptor implements Interceptor {
      async intercept(_r: IncomingMessage, _s: ServerResponse, next: () => Promise<unknown>) {
        log.push('outer-before')
        const result = await next()
        log.push('outer-after')
        return result
      }
    }
    class InnerInterceptor implements Interceptor {
      async intercept(_r: IncomingMessage, _s: ServerResponse, next: () => Promise<unknown>) {
        log.push('inner-before')
        const result = await next()
        log.push('inner-after')
        return result
      }
    }

    const handler = async () => {
      log.push('handler')
      return 'done'
    }
    await runInterceptors([OuterInterceptor, InnerInterceptor], handler, fakeReq, fakeRes)

    // Outer wraps inner: outer-before → inner-before → handler → inner-after → outer-after
    expect(log).toEqual(['outer-before', 'inner-before', 'handler', 'inner-after', 'outer-after'])
  })

  it('test_interceptor_can_transform_response', async () => {
    class WrapInterceptor implements Interceptor {
      async intercept(_r: IncomingMessage, _s: ServerResponse, next: () => Promise<unknown>) {
        const result = await next()
        return { data: result, wrapped: true }
      }
    }
    const handler = async () => ({ id: 1, name: 'test' })

    const result = await runInterceptors([WrapInterceptor], handler, fakeReq, fakeRes)

    expect(result).toEqual({ data: { id: 1, name: 'test' }, wrapped: true })
  })

  it('test_interceptor_can_short_circuit', async () => {
    const handlerSpy = vi.fn().mockResolvedValue('should-not-reach')

    class CacheInterceptor implements Interceptor {
      async intercept(_r: IncomingMessage, _s: ServerResponse, _next: () => Promise<unknown>) {
        // Short-circuit: return cached value without calling next()
        return { cached: true }
      }
    }

    const result = await runInterceptors([CacheInterceptor], handlerSpy, fakeReq, fakeRes)

    expect(result).toEqual({ cached: true })
    expect(handlerSpy).not.toHaveBeenCalled()
  })

  it('test_interceptor_di_resolution', async () => {
    class DIInterceptor implements Interceptor {
      constructor(public value: string) {}
      async intercept(_r: IncomingMessage, _s: ServerResponse, next: () => Promise<unknown>) {
        const result = await next()
        return { ...(result as object), injected: this.value }
      }
    }

    const container = {
      resolve: <T>(token: Function): T => {
        if (token === DIInterceptor) return new DIInterceptor('from-di') as T
        throw new Error('not found')
      },
    }

    const handler = async () => ({ id: 1 })
    const result = (await runInterceptors(
      [DIInterceptor],
      handler,
      fakeReq,
      fakeRes,
      container,
    )) as { injected: string }

    expect(result.injected).toBe('from-di')
  })

  it('test_interceptor_error_propagates_to_catch', async () => {
    class FailInterceptor implements Interceptor {
      async intercept(_r: IncomingMessage, _s: ServerResponse, _next: () => Promise<unknown>) {
        throw new Error('interceptor-boom')
      }
    }

    const handler = async () => 'ok'
    await expect(runInterceptors([FailInterceptor], handler, fakeReq, fakeRes)).rejects.toThrow(
      'interceptor-boom',
    )
  })

  it('test_interceptor_double_next_returns_cached', async () => {
    let handlerCallCount = 0

    class DoubleCallInterceptor implements Interceptor {
      async intercept(_r: IncomingMessage, _s: ServerResponse, next: () => Promise<unknown>) {
        const first = await next()
        const second = await next() // second call should return cached
        return { first, second }
      }
    }

    const handler = async () => {
      handlerCallCount++
      return { count: handlerCallCount }
    }
    const result = (await runInterceptors([DoubleCallInterceptor], handler, fakeReq, fakeRes)) as {
      first: unknown
      second: unknown
    }

    expect(handlerCallCount).toBe(1) // handler called only once
    expect(result.first).toEqual({ count: 1 })
    expect(result.second).toEqual({ count: 1 }) // cached
  })

  it('test_no_interceptors_runs_handler_directly', async () => {
    const handler = async () => 'direct'
    const result = await runInterceptors([], handler, fakeReq, fakeRes)
    expect(result).toBe('direct')
  })

  it('test_interceptor_can_set_response_headers', async () => {
    const mockRes = { setHeader: vi.fn() } as unknown as ServerResponse

    class TimingInterceptor implements Interceptor {
      async intercept(_r: IncomingMessage, res: ServerResponse, next: () => Promise<unknown>) {
        const start = Date.now()
        const result = await next()
        res.setHeader('X-Response-Time', `${Date.now() - start}ms`)
        return result
      }
    }

    const handler = async () => 'ok'
    await runInterceptors([TimingInterceptor], handler, fakeReq, mockRes)

    expect(mockRes.setHeader).toHaveBeenCalledWith(
      'X-Response-Time',
      expect.stringMatching(/\d+ms/),
    )
  })
})
