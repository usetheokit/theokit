import 'reflect-metadata'
import { describe, it, expect, vi } from 'vitest'
import { Catch } from '../../src/decorators/middleware.js'
import {
  runExceptionFilters,
  type ExceptionFilter,
  type ArgumentsHost,
} from '../../src/bridge/exception-filter-chain.js'
import {
  HttpException,
  NotFoundException,
  BadRequestException,
} from '../../src/exceptions/index.js'

// Bun lacks emitDecoratorMetadata support (same as esbuild). Tests using
// decorator syntax require SWC compilation provided by vitest. Skip on Bun.
const isVitest = typeof process !== 'undefined' && !!process.env.VITEST

const fakeReq = new Request('http://localhost/test')

describe.skipIf(!isVitest)('T2.2 — Exception filter chain', () => {
  it('test_filter_catches_matching_exception', async () => {
    const log: string[] = []

    @Catch(NotFoundException)
    class NotFoundFilter implements ExceptionFilter {
      catch(_ex: unknown, _host: ArgumentsHost) {
        log.push('caught')
        return new Response(JSON.stringify({ custom: true }), { status: 404 })
      }
    }

    const res = await runExceptionFilters(new NotFoundException(), [NotFoundFilter], fakeReq)
    expect(log).toEqual(['caught'])
    expect(res.status).toBe(404)
  })

  it('test_filter_ignores_non_matching', async () => {
    @Catch(NotFoundException)
    class NotFoundFilter implements ExceptionFilter {
      catch() {
        return new Response('{}', { status: 999 })
      }
    }

    const res = await runExceptionFilters(new BadRequestException(), [NotFoundFilter], fakeReq)
    // Falls through to built-in: BadRequestException → 400
    expect(res.status).toBe(400)
  })

  it('test_catch_all_filter', async () => {
    const log: string[] = []

    @Catch()
    class CatchAllFilter implements ExceptionFilter {
      catch(_ex: unknown, _host: ArgumentsHost) {
        log.push('catch-all')
        return new Response('{}', { status: 500 })
      }
    }

    await runExceptionFilters(new Error('random'), [CatchAllFilter], fakeReq)
    expect(log).toEqual(['catch-all'])
  })

  it('test_http_exception_auto_formats', async () => {
    const res = await runExceptionFilters(new NotFoundException('Task 99'), [], fakeReq)
    expect(res.status).toBe(404)
    const body = await res.text()
    expect(body).toContain('NOT_FOUND')
    expect(body).toContain('Task 99')
  })

  it('test_unknown_exception_produces_500', async () => {
    const res = await runExceptionFilters(new Error('boom'), [], fakeReq)
    expect(res.status).toBe(500)
    const body = await res.text()
    expect(body).toContain('INTERNAL_SERVER_ERROR')
  })

  it('test_filter_that_throws_falls_to_global', async () => {
    @Catch(HttpException)
    class BrokenFilter implements ExceptionFilter {
      catch(_exception: unknown, _host: ArgumentsHost): Response {
        throw new Error('filter-crash')
      }
    }

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await runExceptionFilters(new NotFoundException(), [BrokenFilter], fakeReq)
    expect(res.status).toBe(500) // global fallback
    consoleSpy.mockRestore()
  })

  it('test_unhandled_error_returns_500_response', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await runExceptionFilters(new Error('late'), [], fakeReq)
    expect(res.status).toBe(500)
    consoleSpy.mockRestore()
  })

  it('test_filter_di_resolution', async () => {
    @Catch(HttpException)
    class DIFilter implements ExceptionFilter {
      constructor(public label: string) {}
      catch(_ex: unknown, _host: ArgumentsHost) {
        return new Response(JSON.stringify({ label: this.label }), { status: 418 })
      }
    }
    const registry = new Map<Function, unknown>([[DIFilter, new DIFilter('from-di')]])
    const container = {
      resolve: (token: Function): unknown => {
        const instance = registry.get(token)
        if (instance) return instance
        throw new Error('not found')
      },
    }
    const res = await runExceptionFilters(new NotFoundException(), [DIFilter], fakeReq, container)
    expect(res.status).toBe(418)
    const body = await res.text()
    expect(body).toContain('from-di')
  })
})
