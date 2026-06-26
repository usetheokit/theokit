/**
 * routes-framework-contract T1.2 / T1.3 — `response` Zod slot on RouteConfig,
 * validated by BOTH runtimes before serializing a plain-object handler return.
 *
 * ADR D1 (plain optional field, runner-validated) + D2 (mismatch is a SERVER
 * fault → 500-class envelope, distinct from the 400 used for input validation).
 *
 * Node runner: `executeRoute` (http/execute.ts) — IncomingMessage/ServerResponse.
 * Web runner:  `executeWebRequest` (web-handler.ts) — WHATWG Request/Response.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'

import { executeRoute } from '../../packages/theo/src/server/http/execute.js'
import type { ServerRouteNode } from '../../packages/theo/src/server/scan/match.js'
import { defineRoute } from '../../packages/theo/src/server/define/define-route.js'
import { executeWebRequest } from '../../packages/theo/src/server/web-handler.js'

// --- Node runner mocks (mirrors execute-transformer.test.ts) -----------------

function createMockReq(method = 'GET', url = '/api/test'): IncomingMessage {
  return {
    method,
    url,
    headers: { host: 'localhost:3000' },
    on: vi.fn(),
  } as unknown as IncomingMessage
}

function createMockRes(): ServerResponse & {
  _getStatus: () => number
  _getBody: () => string
} {
  let status = 0
  let body = ''
  const headers: Record<string, string> = {}
  const res = {
    writeHead: vi.fn((s: number, hdrs?: Record<string, string>) => {
      status = s
      if (hdrs) Object.assign(headers, hdrs)
    }),
    write: vi.fn(),
    end: vi.fn((b?: string) => {
      if (b) body = b
    }),
    setHeader: vi.fn((k: string, v: string) => {
      headers[k.toLowerCase()] = v
    }),
    getHeader: vi.fn((k: string) => headers[k.toLowerCase()]),
    on: vi.fn(),
    headersSent: false,
    writableEnded: false,
    writableFinished: false,
    statusCode: 200,
    _getStatus: () => status,
    _getBody: () => body,
  } as unknown as ServerResponse & { _getStatus: () => number; _getBody: () => string }
  return res
}

function createRoute(): ServerRouteNode {
  return {
    filePath: '/fake',
    routePath: '/api/test',
    pattern: /^\/api\/test$/,
    paramNames: [],
  }
}

const responseSchema = z.object({ id: z.string() })

describe('Node runner — config.response validation (T1.2)', () => {
  it('passes a valid plain object through with 200 + body', async () => {
    const res = createMockRes()
    await executeRoute({
      route: createRoute(),
      method: 'GET',
      params: {},
      req: createMockReq(),
      res,
      loadModule: async () => ({ GET: { response: responseSchema, handler: () => ({ id: 'x' }) } }),
    })
    expect(res._getStatus()).toBe(200)
    expect(JSON.parse(res._getBody())).toEqual({ id: 'x' })
  })

  it('rejects an output that drifts from the schema with a 500', async () => {
    const res = createMockRes()
    await executeRoute({
      route: createRoute(),
      method: 'GET',
      params: {},
      req: createMockReq(),
      res,
      // id is a number — violates z.object({ id: z.string() })
      loadModule: async () => ({ GET: { response: responseSchema, handler: () => ({ id: 123 }) } }),
    })
    expect(res._getStatus()).toBe(500)
  })

  it('skips validation entirely when no response schema is declared', async () => {
    const res = createMockRes()
    await executeRoute({
      route: createRoute(),
      method: 'GET',
      params: {},
      req: createMockReq(),
      res,
      // no `response` slot — drifting shape is shipped unchanged
      loadModule: async () => ({ GET: { handler: () => ({ id: 123 }) } }),
    })
    expect(res._getStatus()).toBe(200)
    expect(JSON.parse(res._getBody())).toEqual({ id: 123 })
  })

  it('does NOT validate a Response-instance return (passthrough)', async () => {
    const res = createMockRes()
    await executeRoute({
      route: createRoute(),
      method: 'GET',
      params: {},
      req: createMockReq(),
      res,
      loadModule: async () => ({
        GET: {
          response: responseSchema,
          // returns a Response with a body that would FAIL the schema —
          // but Response instances are never validated (D1).
          handler: () => new Response(JSON.stringify({ id: 123 }), { status: 201 }),
        },
      }),
    })
    expect(res._getStatus()).toBe(201)
  })
})

describe('Web runner — config.response validation parity (T1.3)', () => {
  function req(): Request {
    return new Request('http://localhost/api/test', { method: 'GET' })
  }

  it('passes a valid plain object through with 200 + body', async () => {
    const route = { GET: defineRoute({ response: responseSchema, handler: () => ({ id: 'x' }) }) }
    const response = await executeWebRequest(req(), route)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ id: 'x' })
  })

  it('rejects an output that drifts from the schema with a 500 envelope', async () => {
    const route = {
      GET: defineRoute({ response: responseSchema, handler: () => ({ id: 123 }) }),
    }
    const response = await executeWebRequest(req(), route)
    expect(response.status).toBe(500)
    const body = (await response.json()) as { code: string }
    expect(body.code).toBe('INTERNAL_SERVER_ERROR')
  })

  it('skips validation entirely when no response schema is declared', async () => {
    const route = { GET: defineRoute({ handler: () => ({ id: 123 }) }) }
    const response = await executeWebRequest(req(), route)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ id: 123 })
  })

  it('does NOT validate a Response-instance return (passthrough)', async () => {
    const route = {
      GET: defineRoute({
        response: responseSchema,
        handler: () => new Response(JSON.stringify({ id: 123 }), { status: 201 }),
      }),
    }
    const response = await executeWebRequest(req(), route)
    expect(response.status).toBe(201)
  })
})
