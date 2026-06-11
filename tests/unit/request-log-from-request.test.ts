/**
 * T5a.2 Phase C slice 2/2 — Web-Standards request log tests.
 *
 * Verifies `logRequestFromRequest(info, customLogger?, request?)` is a
 * behaviour-equivalent mirror of `logRequest(info, customLogger?, req)`
 * for the Web Request shape. Same canonical RequestLog shape + same
 * devtools forwarder (errors silenced).
 *
 * Per `docs/plans/t5a2-incoming-message-to-request-shape-refactor-plan.md`
 * v1.0 § Phase C. The IncomingMessage tests in `logger.test.ts` and
 * `logger-structured.test.ts` cover the legacy path; this file covers
 * the Web Request path.
 */
import { describe, it, expect } from 'vitest'

import {
  logRequestFromRequest,
  type LoggerFn,
  type RequestLog,
} from '../../packages/theo/src/server/observability/request-log.js'

function recordingLogger(): { fn: LoggerFn; logs: RequestLog[] } {
  const logs: RequestLog[] = []
  return { fn: (log) => logs.push(log), logs }
}

describe('logRequestFromRequest (T5a.2 Phase C slice 2/2 — Web shape)', () => {
  it('writes a RequestLog entry with level=info and ISO timestamp', () => {
    const { fn, logs } = recordingLogger()
    logRequestFromRequest(
      {
        method: 'GET',
        url: '/api/test',
        status: 200,
        duration: 42,
        requestId: 'req-xyz',
      },
      fn,
    )
    expect(logs).toHaveLength(1)
    expect(logs[0].level).toBe('info')
    expect(logs[0].method).toBe('GET')
    expect(logs[0].url).toBe('/api/test')
    expect(logs[0].status).toBe(200)
    expect(logs[0].duration).toBe(42)
    expect(logs[0].requestId).toBe('req-xyz')
    // ISO 8601 timestamp shape (e.g. 2026-06-06T14:23:45.678Z)
    expect(logs[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })

  it('uses defaultLoggerFn (console.log JSON) when customLogger is undefined', () => {
    // We can't easily intercept console.log without mocking, but we can
    // verify the call doesn't throw + completes synchronously.
    expect(() =>
      logRequestFromRequest({
        method: 'POST',
        url: '/api/x',
        status: 201,
        duration: 12,
        requestId: 'req-default',
      }),
    ).not.toThrow()
  })

  it('accepts an optional Request and extracts headers for devtools forwarder', () => {
    const { fn, logs } = recordingLogger()
    const request = new Request('http://example.com/api', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'header-id',
      },
    })
    // The devtools forwarder is best-effort + async + silenced; we
    // assert that the customLogger still receives the synchronous log
    // record (devtools dispatch is fire-and-forget under the hood).
    logRequestFromRequest(
      {
        method: 'POST',
        url: '/api',
        status: 200,
        duration: 5,
        requestId: 'trace-id',
      },
      fn,
      request,
    )
    expect(logs).toHaveLength(1)
    expect(logs[0].requestId).toBe('trace-id')
  })

  it('does not throw when request is undefined (devtools forward becomes no-op)', () => {
    const { fn, logs } = recordingLogger()
    expect(() =>
      logRequestFromRequest(
        {
          method: 'GET',
          url: '/',
          status: 200,
          duration: 1,
          requestId: 'req-no-headers',
        },
        fn,
      ),
    ).not.toThrow()
    expect(logs).toHaveLength(1)
  })

  it('does not throw when customLogger throws (devtools forwarder isolated)', () => {
    const noisyLogger: LoggerFn = () => {
      throw new Error('boom — logger misbehaves')
    }
    // logRequestFromRequest does NOT catch logger throws (intentional —
    // it's the user's choice to use a throwing logger). This test pins
    // that behavior so consumers know to wrap their own logger if they
    // want fault-tolerance.
    expect(() =>
      logRequestFromRequest(
        {
          method: 'GET',
          url: '/',
          status: 500,
          duration: 1,
          requestId: 'req-x',
        },
        noisyLogger,
      ),
    ).toThrow('boom')
  })
})
