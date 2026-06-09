import 'reflect-metadata'
import { describe, it, expect, vi } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
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

function fakeRes() {
  const chunks: string[] = []
  return {
    headersSent: false,
    statusCode: 0,
    writeHead(status: number, _headers?: Record<string, string>) {
      this.statusCode = status
    },
    end(body?: string) {
      if (body) chunks.push(body)
    },
    chunks,
  } as unknown as ServerResponse
}
const fakeReq = {} as IncomingMessage

describe('T2.2 — Exception filter chain', () => {
  it('test_filter_catches_matching_exception', async () => {
    const log: string[] = []

    @Catch(NotFoundException)
    class NotFoundFilter implements ExceptionFilter {
      catch(ex: unknown, host: ArgumentsHost) {
        log.push('caught')
        const res = host.getResponse()
        res.writeHead(404)
        res.end(JSON.stringify({ custom: true }))
      }
    }

    const res = fakeRes()
    await runExceptionFilters(new NotFoundException(), [NotFoundFilter], fakeReq, res)
    expect(log).toEqual(['caught'])
    expect(res.statusCode).toBe(404)
  })

  it('test_filter_ignores_non_matching', async () => {
    @Catch(NotFoundException)
    class NotFoundFilter implements ExceptionFilter {
      catch() {
        /* should not run */
      }
    }

    const res = fakeRes()
    await runExceptionFilters(new BadRequestException(), [NotFoundFilter], fakeReq, res)
    // Falls through to built-in: BadRequestException → 400
    expect(res.statusCode).toBe(400)
  })

  it('test_catch_all_filter', async () => {
    const log: string[] = []

    @Catch()
    class CatchAllFilter implements ExceptionFilter {
      catch(_ex: unknown, host: ArgumentsHost) {
        log.push('catch-all')
        host.getResponse().writeHead(500)
        host.getResponse().end('{}')
      }
    }

    const res = fakeRes()
    await runExceptionFilters(new Error('random'), [CatchAllFilter], fakeReq, res)
    expect(log).toEqual(['catch-all'])
  })

  it('test_http_exception_auto_formats', async () => {
    const res = fakeRes()
    await runExceptionFilters(new NotFoundException('Task 99'), [], fakeReq, res)
    expect(res.statusCode).toBe(404)
    expect(res.chunks[0]).toContain('NOT_FOUND')
    expect(res.chunks[0]).toContain('Task 99')
  })

  it('test_unknown_exception_produces_500', async () => {
    const res = fakeRes()
    await runExceptionFilters(new Error('boom'), [], fakeReq, res)
    expect(res.statusCode).toBe(500)
    expect(res.chunks[0]).toContain('INTERNAL_SERVER_ERROR')
  })

  it('test_filter_that_throws_falls_to_global', async () => {
    @Catch(HttpException)
    class BrokenFilter implements ExceptionFilter {
      catch() {
        throw new Error('filter-crash')
      }
    }

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = fakeRes()
    await runExceptionFilters(new NotFoundException(), [BrokenFilter], fakeReq, res)
    expect(res.statusCode).toBe(500) // global fallback
    consoleSpy.mockRestore()
  })

  it('test_headers_already_sent_skips_response', async () => {
    const res = fakeRes()
    ;(res as { headersSent: boolean }).headersSent = true
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await runExceptionFilters(new Error('late'), [], fakeReq, res)
    expect(res.statusCode).toBe(0) // unchanged — didn't write
    consoleSpy.mockRestore()
  })

  it('test_filter_di_resolution', async () => {
    @Catch(HttpException)
    class DIFilter implements ExceptionFilter {
      constructor(public label: string) {}
      catch(_ex: unknown, host: ArgumentsHost) {
        host.getResponse().writeHead(418)
        host.getResponse().end(JSON.stringify({ label: this.label }))
      }
    }
    const container = {
      resolve: <T>(token: Function): T => {
        if (token === DIFilter) return new DIFilter('from-di') as T
        throw new Error('not found')
      },
    }
    const res = fakeRes()
    await runExceptionFilters(new NotFoundException(), [DIFilter], fakeReq, res, container)
    expect(res.statusCode).toBe(418)
    expect(res.chunks[0]).toContain('from-di')
  })
})
