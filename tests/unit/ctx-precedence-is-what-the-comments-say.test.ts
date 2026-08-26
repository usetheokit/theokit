/**
 * Who wins when two sources write the same `ctx` key.
 *
 * The order is not obvious from any single line, which is why two comments in `execute.ts` got it
 * wrong at once (#496) — one shipped in 0.54.0 saying "middleware wins on a key collision", the
 * other saying decorations win "when middleware did not set the same key". Both describe the
 * mechanism they sit next to and neither describes the outcome.
 *
 * A comment cannot hold a precedence rule. This can.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, vi } from 'vitest'

import { executeRoute } from '../../packages/theo/src/server/http/execute.js'
import { PluginRunner } from '../../packages/theo/src/server/plugins/plugin-runner.js'
import type { ServerRouteNode } from '../../packages/theo/src/server/scan/match.js'

function createReq(): IncomingMessage {
  return {
    method: 'GET',
    url: '/api/me',
    headers: { host: 'localhost:3000' },
    on: vi.fn(),
  } as unknown as IncomingMessage
}

function createRes(): ServerResponse & { _getBody: () => string } {
  let body = ''
  return {
    writeHead: vi.fn(),
    write: vi.fn(),
    end: vi.fn((b?: string) => {
      if (b) body = b
    }),
    setHeader: vi.fn(),
    getHeader: vi.fn(),
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

/** A `server/` dir must EXIST for the middleware stage to run at all — that was the #486 trap. */
const serverDir = mkdtempSync(join(tmpdir(), 'theokit-precedence-'))

/** Reads one key back from whatever the handler was finally handed. */
async function whatTheHandlerSees(opts: {
  key: string
  hook?: string
  middleware?: string
  decoration?: string
}): Promise<unknown> {
  const runner = new PluginRunner()
  await runner.register({
    name: 'writes-ctx',
    register(app) {
      if (opts.decoration !== undefined) app.decorateRequest(opts.key, opts.decoration)
      if (opts.hook !== undefined) {
        app.addHook('onRequest', (ctx) => {
          ;(ctx.ctx as Record<string, unknown>)[opts.key] = opts.hook
        })
      }
    },
  })

  const res = createRes()
  await executeRoute({
    route,
    method: 'GET',
    params: {},
    req: createReq(),
    res,
    loadModule: async (path: string) =>
      path.includes('middleware')
        ? {
            default: (
              _req: unknown,
              _res: unknown,
              next: () => void,
              ctx?: Record<string, unknown>,
            ) => {
              if (ctx && opts.middleware !== undefined) ctx[opts.key] = opts.middleware
              next()
            },
          }
        : {
            GET: {
              policy: 'public' as const,
              handler: (c: { ctx: Record<string, unknown> }) => ({ seen: c.ctx[opts.key] }),
            },
          },
    requestId: 'req-precedence',
    pluginRunner: runner,
    // Always supplied. The middleware STAGE has to run in every case — it is the stage that used to
    // discard the hook's write (#486), so a case without it would not be measuring this pipeline.
    serverDir,
  })

  return (JSON.parse(res._getBody()) as { seen: unknown }).seen
}

describe('ctx key precedence', () => {
  it('an onRequest hook write survives the middleware stage (#486)', async () => {
    expect(await whatTheHandlerSees({ key: 'k', hook: 'FROM-HOOK' })).toBe('FROM-HOOK')
  })

  it('a plugin decoration beats an onRequest hook writing the same key', async () => {
    expect(
      await whatTheHandlerSees({ key: 'k', hook: 'FROM-HOOK', decoration: 'FROM-DECORATION' }),
    ).toBe('FROM-DECORATION')
  })

  it('a plugin decoration beats a middleware writing the same key', async () => {
    // The measurement that showed the shipped comment was false: `applyDecorations` re-runs AFTER
    // the middleware merge and assigns unconditionally, so "middleware wins, last writer" is not
    // true of any key a plugin decorated.
    expect(
      await whatTheHandlerSees({
        key: 'k',
        middleware: 'FROM-MIDDLEWARE',
        decoration: 'FROM-DECORATION',
      }),
    ).toBe('FROM-DECORATION')
  })
})
