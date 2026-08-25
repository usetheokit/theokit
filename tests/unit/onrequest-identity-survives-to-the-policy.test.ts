/**
 * Regression — identity established by a plugin's `onRequest` hook MUST still be on `ctx` when
 * `evaluateRoutePolicy` reads it.
 *
 * `execute.ts` says so in-source: "any identity established upstream (middleware, plugin hooks) is
 * on `ctx` by the time the policy reads it." It was true only for apps with no `server/` directory.
 * With one — which is every real TheoKit app — `runMiddlewareAndContext` returns a FRESH object
 * (`middlewareCtx = {}`), `ctx` is reassigned to it, and only `applyDecorations` is replayed on top.
 * A hook that wrote `ctx.subject` had that write discarded, so the policy saw `subject: null` and
 * denied a request the plugin had just authenticated.
 *
 * This is the failure mode ADR 0001 rejects by name, inverted: not a route that looks protected and
 * is not, but a plugin that authenticates and is not believed. Both end with the access decision
 * being made on something other than what the code appears to say.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, vi } from 'vitest'

import { executeRoute } from '../../packages/theo/src/server/http/execute.js'
import { PluginRunner } from '../../packages/theo/src/server/plugins/plugin-runner.js'
import type { ServerRouteNode } from '../../packages/theo/src/server/scan/match.js'

function createMockReq(): IncomingMessage {
  return {
    method: 'GET',
    url: '/api/me',
    headers: { host: 'localhost:3000' },
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

/** An empty `server/` dir: no middleware, but present — which is what triggers the reassignment. */
const emptyServerDir = mkdtempSync(join(tmpdir(), 'theokit-serverdir-'))

/** The plugin every auth integration would write: resolve who is asking, put it on ctx. */
function authenticatingPlugin(subjectId: string) {
  const runner = new PluginRunner()
  return runner
    .register({
      name: 'establishes-identity',
      register(app) {
        app.addHook('onRequest', (ctx) => {
          ;(ctx.ctx as Record<string, unknown>).subject = { id: subjectId }
        })
      },
    })
    .then(() => runner)
}

describe('identity from a plugin hook reaches the route policy', () => {
  it('an onRequest hook that sets ctx.subject is believed by the policy, with a server/ dir present', async () => {
    const runner = await authenticatingPlugin('user-1')
    const res = createMockRes()

    await executeRoute({
      route,
      method: 'GET',
      params: {},
      req: createMockReq(),
      res,
      // The policy asks the one question every real policy asks first.
      loadModule: async () => ({
        GET: {
          policy: ({ subject }: { subject: unknown }) => subject !== null,
          handler: () => ({ ok: true }),
        },
      }),
      requestId: 'req-identity',
      pluginRunner: runner,
      serverDir: emptyServerDir,
    })

    // 403 here means the plugin authenticated the request and the framework forgot before asking.
    expect(res.statusCode).not.toBe(403)
    expect(JSON.parse(res._getBody())).toEqual({ ok: true })
  })

  it('the subject itself survives to the handler, not merely the allow decision', async () => {
    const runner = await authenticatingPlugin('user-2')
    const res = createMockRes()

    await executeRoute({
      route,
      method: 'GET',
      params: {},
      req: createMockReq(),
      res,
      loadModule: async () => ({
        GET: {
          policy: 'public' as const,
          handler: (c: { ctx: Record<string, unknown> }) => ({ seen: c.ctx.subject }),
        },
      }),
      requestId: 'req-identity-handler',
      pluginRunner: runner,
      serverDir: emptyServerDir,
    })

    expect(JSON.parse(res._getBody())).toEqual({ seen: { id: 'user-2' } })
  })
})
