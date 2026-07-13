/**
 * Regression — the Node route executor (`executeRoute`, used by the dev server
 * and `theokit start`) MUST hand the handler a Web `Request` as `ctx.request`,
 * per ADR-0028 R3a and the public `request: Request` handler type.
 *
 * Before the fix it leaked the raw Node `IncomingMessage`, whose `.headers` is a
 * plain object — so `ctx.request.headers.get('cookie')` threw
 * `request.headers.get is not a function` at runtime even though it type-checked.
 * That made `createSessionManagerWeb.getSession(ctx.request)` (the framework's own
 * Web session primitive) unusable from a handler in the Node server.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, it, expect, vi } from 'vitest'

import { executeRoute } from '../../packages/theo/src/server/http/execute.js'
import { PluginRunner } from '../../packages/theo/src/server/plugins/plugin-runner.js'
import type { PluginContext } from '../../packages/theo/src/server/plugin-types.js'
import type { ServerRouteNode } from '../../packages/theo/src/server/scan/match.js'

function createMockReq(
  headers: Record<string, string>,
  method = 'GET',
  url = '/api/me',
): IncomingMessage {
  return {
    method,
    url,
    headers: { host: 'localhost:3000', ...headers },
    on: vi.fn(),
  } as unknown as IncomingMessage
}

function createMockRes(): ServerResponse & { _getBody: () => string } {
  let body = ''
  const headers: Record<string, string> = {}
  return {
    writeHead: vi.fn(),
    write: vi.fn(),
    end: vi.fn((b?: string) => {
      if (b) body = b
    }),
    setHeader: vi.fn((k: string, v: string) => {
      headers[k.toLowerCase()] = v
    }),
    getHeader: vi.fn((k: string) => headers[k.toLowerCase()]),
    headersSent: false,
    writableEnded: false,
    statusCode: 200,
    _getBody: () => body,
  } as unknown as ServerResponse & { _getBody: () => string }
}

const route: ServerRouteNode = {
  filePath: '/fake',
  routePath: '/api/me',
  pattern: /^\/api\/me$/,
  paramNames: [],
}

describe('executeRoute hands the handler a Web Request (ADR-0028 R3a)', () => {
  it('ctx.request is a Web Request — .headers.get / .url / .method work in the Node path', async () => {
    let captured: Request | undefined
    const loader = async () => ({
      GET: {
        handler: (ctx: { request: Request }) => {
          captured = ctx.request
          // These are the Web-standard calls that threw when ctx.request was an IncomingMessage.
          return { cookie: ctx.request.headers.get('cookie'), method: ctx.request.method }
        },
      },
    })

    const res = createMockRes()
    await executeRoute({
      route,
      method: 'GET',
      params: {},
      req: createMockReq({ cookie: 'theokit_session=abc123' }),
      res,
      loadModule: loader,
      requestId: 'req-web-shape',
    })

    expect(captured).toBeInstanceOf(Request)
    expect(typeof captured?.headers.get).toBe('function')
    expect(captured?.headers.get('cookie')).toBe('theokit_session=abc123')
    expect(captured?.method).toBe('GET')
    expect(new URL(captured!.url).pathname).toBe('/api/me')
    expect(JSON.parse(res._getBody())).toEqual({ cookie: 'theokit_session=abc123', method: 'GET' })
  })

  // #119 — plugin hooks must ALSO see a Web Request in the Node path, so a plugin's
  // `ctx.request.headers.get(...)` is portable across `theokit dev`/`start` (Node) and edge adapters.
  it('plugin onRequest hooks receive a Web Request as ctx.request (#119)', async () => {
    let captured: PluginContext['request'] | undefined
    const runner = new PluginRunner()
    await runner.register({
      name: 'capture-request',
      register(app) {
        app.addHook('onRequest', (ctx) => {
          captured = ctx.request
        })
      },
    })

    const res = createMockRes()
    await executeRoute({
      route,
      method: 'GET',
      params: {},
      req: createMockReq({ cookie: 'theokit_session=plugin1' }),
      res,
      loadModule: async () => ({ GET: { handler: () => ({ ok: true }) } }),
      requestId: 'req-plugin-shape',
      pluginRunner: runner,
    })

    expect(captured).toBeInstanceOf(Request)
    expect(captured?.headers.get('cookie')).toBe('theokit_session=plugin1')
    expect(captured?.method).toBe('GET')
  })
})
