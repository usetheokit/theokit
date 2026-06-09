/**
 * T5a.2 Phase G slice 4/N — Web-Standards response helper tests.
 *
 * Verifies `buildJsonResponse` + `buildErrorResponse` return native
 * `Response` instances with the same shape semantics as `sendJson` +
 * `sendError` on the IncomingMessage path.
 *
 * Per `docs/plans/t5a2-incoming-message-to-request-shape-refactor-plan.md`
 * v1.0 § Phase G.
 */
import { describe, it, expect } from 'vitest'

import {
  buildErrorResponse,
  buildJsonResponse,
} from '../../packages/theo/src/server/http/send-response.js'
import type { TheoTransformer } from '../../packages/theo/src/server/transformer.js'

describe('buildJsonResponse (T5a.2 Phase G slice 4/N — Web shape)', () => {
  it('defaults status to 200 + content-type application/json', async () => {
    const response = buildJsonResponse({ ok: true })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    const body = (await response.json()) as { ok: boolean }
    expect(body.ok).toBe(true)
  })

  it('accepts custom status code', () => {
    const response = buildJsonResponse({ created: true }, 201)
    expect(response.status).toBe(201)
  })

  it('uses transformer.serialize when provided', async () => {
    const transformer: TheoTransformer = {
      name: 'test-transformer',
      serialize: (data: unknown) => `__SERIALIZED__${JSON.stringify(data)}`,
      deserialize: (payload: string) => JSON.parse(payload.replace(/^__SERIALIZED__/, '')),
    }
    const response = buildJsonResponse({ x: 1 }, 200, transformer)
    expect(await response.text()).toBe('__SERIALIZED__{"x":1}')
  })

  it('does NOT set Content-Length header (runtime computes from body)', () => {
    const response = buildJsonResponse({ ok: true })
    expect(response.headers.get('content-length')).toBeNull()
  })
})

describe('buildErrorResponse (T5a.2 Phase G slice 4/N — Web shape)', () => {
  it('returns envelope-wrapped { error: { code, message } } shape', async () => {
    const response = buildErrorResponse({
      code: 'BAD_REQUEST',
      message: 'invalid input',
      status: 400,
    })
    expect(response.status).toBe(400)
    expect(response.headers.get('content-type')).toContain('application/json')
    const body = (await response.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('BAD_REQUEST')
    expect(body.error.message).toBe('invalid input')
  })

  it('includes requestId in body + x-request-id header when provided', async () => {
    const response = buildErrorResponse({
      code: 'UNAUTHORIZED',
      message: 'token expired',
      status: 401,
      requestId: 'req-trace-id',
    })
    expect(response.headers.get('x-request-id')).toBe('req-trace-id')
    const body = (await response.json()) as { error: { requestId: string } }
    expect(body.error.requestId).toBe('req-trace-id')
  })

  it('omits requestId from body + header when undefined', async () => {
    const response = buildErrorResponse({
      code: 'BAD_REQUEST',
      message: 'invalid',
      status: 400,
    })
    expect(response.headers.get('x-request-id')).toBeNull()
    const body = (await response.json()) as { error: { requestId?: string } }
    expect(body.error.requestId).toBeUndefined()
  })

  it('includes issues array when provided (validation errors)', async () => {
    const issues = [{ path: 'email', message: 'invalid format' }]
    const response = buildErrorResponse({
      code: 'VALIDATION_ERROR',
      message: 'fields failed validation',
      status: 422,
      issues,
    })
    const body = (await response.json()) as { error: { issues?: unknown[] } }
    expect(body.error.issues).toEqual(issues)
  })

  it('custom 404 HTML when options.custom404Html provided AND status === 404', async () => {
    const html = '<html><body>Custom 404</body></html>'
    const response = buildErrorResponse({
      code: 'NOT_FOUND',
      message: 'route missing',
      status: 404,
      options: { custom404Html: html },
    })
    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toContain('text/html')
    expect(await response.text()).toBe(html)
  })

  it('custom 500 HTML when options.custom500Html provided AND status === 500', async () => {
    const html = '<html><body>Custom 500</body></html>'
    const response = buildErrorResponse({
      code: 'INTERNAL_ERROR',
      message: 'crashed',
      status: 500,
      options: { custom500Html: html },
    })
    expect(response.status).toBe(500)
    expect(response.headers.get('content-type')).toContain('text/html')
    expect(await response.text()).toBe(html)
  })

  it("custom HTML options ignored when status doesn't match (404 HTML on 500 status)", async () => {
    const response = buildErrorResponse({
      code: 'INTERNAL_ERROR',
      message: 'oops',
      status: 500,
      options: { custom404Html: '<html>404</html>' }, // wrong status — ignored
    })
    expect(response.headers.get('content-type')).toContain('application/json')
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('INTERNAL_ERROR')
  })

  it('production mode hides INTERNAL_ERROR message details (env-gated)', async () => {
    const prevEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      const response = buildErrorResponse({
        code: 'INTERNAL_ERROR',
        message: 'leaky internal stack trace',
        status: 500,
      })
      const body = (await response.json()) as { error: { code: string; message: string } }
      expect(body.error.message).toBe('Internal server error')
      expect(body.error.message).not.toContain('leaky')
    } finally {
      if (prevEnv === undefined) {
        delete process.env.NODE_ENV
      } else {
        process.env.NODE_ENV = prevEnv
      }
    }
  })

  it('non-production INTERNAL_ERROR preserves message (debug visibility)', async () => {
    const prevEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'development'
    try {
      const response = buildErrorResponse({
        code: 'INTERNAL_ERROR',
        message: 'debug detail',
        status: 500,
      })
      const body = (await response.json()) as { error: { code: string; message: string } }
      expect(body.error.message).toBe('debug detail')
    } finally {
      if (prevEnv === undefined) {
        delete process.env.NODE_ENV
      } else {
        process.env.NODE_ENV = prevEnv
      }
    }
  })
})
