import 'reflect-metadata'

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { join, resolve } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { loadControllerWithSwc } from '../../packages/http/dist/index.js'
import { dispatchControllerRequest } from '../../packages/theo/src/server/http/controller-dispatch.js'
import { createApiMiddleware } from '../../packages/theo/src/vite-plugin/api-middleware.js'
import { PluginRunner } from '../../packages/theo/src/server/plugins/plugin-runner.js'
import type { TheoApp } from '../../packages/theo/src/server/plugin-types.js'

/**
 * usetheokit/theokit#607 + #609 — every route kind runs the plugin lifecycle, exactly once.
 *
 * ## The two defects this pins, which are one defect seen from two ends
 *
 * A plugin's hooks are the only supported place for a cross-cutting concern: identity, rate
 * limiting, audit, a span. Two paths disagreed with that contract in opposite directions, and
 * both were measured against a real app before being written down here.
 *
 * **#607 — a `@Controller` route ran NO hook at all.** `dispatchControllerRequest` had no
 * parameter for a plugin runner, so neither caller could pass one:
 * `cli/commands/start/handlers.ts` (production) and `vite-plugin/api-middleware.ts` (dev). An
 * adopter's identity plugin was 95 lines of dead weight that the boot log reported as registered,
 * and a rate limiter written as a `preHandler` for three routes that bill per call enforced
 * nothing while reading exactly like protection.
 *
 * **#609 — a matched FILE route ran `onRequest` twice in dev.** The middleware called
 * `runOnRequest` once before `matchRoute` and `executeRoute` called it again. Nothing deduped, so
 * anything an `onRequest` counted, billed or traced was doubled in dev and single in production —
 * the surface nobody instruments being the wrong one.
 *
 * The two share a cause: the dev middleware had a second, uncoordinated lifecycle entry point, and
 * the controller path had none. Fixing either alone makes the other worse, so they are pinned
 * together.
 *
 * ## Why the assertions are counts and not truthiness
 *
 * `expect(fired).toBe(true)` passes on both the correct behaviour and on #609. The number is the
 * whole finding in one direction and half of it in the other, so every assertion here counts.
 */
const TEST_ROOT = resolve(__dirname, '../../packages/theo/__controller_plugin_lifecycle__')
const SERVER_DIR = join(TEST_ROOT, 'server')
const CONTROLLERS_DIR = join(SERVER_DIR, 'controllers')
const ROUTES_DIR = join(SERVER_DIR, 'routes')

const CONTROLLER_SRC = `
import 'reflect-metadata'
import { Controller, Get, Public } from '@theokit/http'

@Public()
@Controller('api/health')
export class HealthController {
  @Get()
  status() {
    return { status: 'ok' }
  }
}
`

/** A file route, so the same run can discriminate the two route kinds. */
const ROUTE_SRC = `export const GET = { policy: 'public', handler: () => ({ fileRoute: true }) }\n`

interface HookCounts {
  onRequest: number
  preHandler: number
  onResponse: number
}

/** A plugin that counts, because a boolean cannot tell "ran" from "ran twice". */
async function countingRunner(): Promise<{ runner: PluginRunner; counts: HookCounts }> {
  const counts: HookCounts = { onRequest: 0, preHandler: 0, onResponse: 0 }
  const runner = new PluginRunner()
  await runner.register({
    name: 'counter',
    register(app: TheoApp) {
      app.addHook('onRequest', () => {
        counts.onRequest++
      })
      app.addHook('preHandler', () => {
        counts.preHandler++
      })
      app.addHook('onResponse', () => {
        counts.onResponse++
      })
    },
  })
  return { runner, counts }
}

function makeReq(url: string): IncomingMessage {
  const stream = Readable.from([]) as unknown as IncomingMessage
  stream.method = 'GET'
  stream.url = url
  stream.headers = { host: 'localhost:3000' }
  return stream
}

function makeRes(): { res: ServerResponse; status: () => number; body: () => string } {
  let status = 200
  let body = ''
  let ended = false
  const headers: Record<string, unknown> = {}
  const res = {
    statusCode: 200,
    headersSent: false,
    get writableEnded(): boolean {
      return ended
    },
    writeHead(s: number): ServerResponse {
      status = s
      ;(res as unknown as { statusCode: number }).statusCode = s
      return res as unknown as ServerResponse
    },
    setHeader(name: string, value: unknown): ServerResponse {
      headers[name] = value
      return res as unknown as ServerResponse
    },
    getHeader(name: string): unknown {
      return headers[name]
    },
    end(chunk?: string): void {
      if (chunk) body += chunk
      ended = true
    },
  } as unknown as ServerResponse
  return { res, status: () => status, body: () => body }
}

async function runMiddleware(
  middleware: ReturnType<typeof createApiMiddleware>,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  return new Promise((resolve) => {
    let nextCalled = false
    middleware(req, res, () => {
      nextCalled = true
      resolve()
    })
    const poll = setInterval(() => {
      if (nextCalled || (res as unknown as { writableEnded: boolean }).writableEnded) {
        clearInterval(poll)
        resolve()
      }
    }, 5)
    setTimeout(() => {
      clearInterval(poll)
      resolve()
    }, 3000)
  })
}

beforeAll(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true })
  mkdirSync(CONTROLLERS_DIR, { recursive: true })
  mkdirSync(ROUTES_DIR, { recursive: true })
  writeFileSync(join(CONTROLLERS_DIR, 'health.controller.ts'), CONTROLLER_SRC)
  writeFileSync(join(ROUTES_DIR, 'probe.ts'), ROUTE_SRC)
})

afterAll(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true })
})

describe('a @Controller route runs the plugin lifecycle (#607)', () => {
  it('runs onRequest, preHandler and onResponse once each when the dispatcher is given a runner', async () => {
    const { runner, counts } = await countingRunner()
    const { res, status, body } = makeRes()

    const handled = await dispatchControllerRequest({
      controllersDir: CONTROLLERS_DIR,
      loadModule: (p: string) => loadControllerWithSwc(p),
      req: makeReq('/api/health'),
      res,
      csrfMode: 'off',
      requestId: 'test-request',
      pluginRunner: runner,
    })

    expect(handled).toBe(true)
    expect(status()).toBe(200)
    expect(JSON.parse(body())).toEqual({ status: 'ok' })
    expect(counts).toEqual({ onRequest: 1, preHandler: 1, onResponse: 1 })
  })

  it('still serves the route when no runner is given, at no cost', async () => {
    const { res, status } = makeRes()
    const handled = await dispatchControllerRequest({
      controllersDir: CONTROLLERS_DIR,
      loadModule: (p: string) => loadControllerWithSwc(p),
      req: makeReq('/api/health'),
      res,
      csrfMode: 'off',
      requestId: 'test-request',
    })
    expect(handled).toBe(true)
    expect(status()).toBe(200)
  })
})

describe('the dev middleware fires each hook exactly once, for both route kinds (#607 + #609)', () => {
  it('fires onRequest once for a matched FILE route — not twice', async () => {
    const { runner, counts } = await countingRunner()
    const middleware = createApiMiddleware(
      { ssrLoadModule: (p: string) => loadControllerWithSwc(p) } as unknown as never,
      SERVER_DIR,
      { pluginRunner: runner, csrfMode: 'off' },
    )
    const { res, body } = makeRes()
    await runMiddleware(middleware, makeReq('/api/probe'), res)

    expect(JSON.parse(body())).toEqual({ fileRoute: true })
    expect(counts.onRequest).toBe(1)
    expect(counts.preHandler).toBe(1)
  })

  it('fires onRequest and preHandler once for a @Controller route', async () => {
    const { runner, counts } = await countingRunner()
    const middleware = createApiMiddleware(
      { ssrLoadModule: (p: string) => loadControllerWithSwc(p) } as unknown as never,
      SERVER_DIR,
      { pluginRunner: runner, csrfMode: 'off' },
    )
    const { res, body } = makeRes()
    await runMiddleware(middleware, makeReq('/api/health'), res)

    expect(JSON.parse(body())).toEqual({ status: 'ok' })
    expect(counts.onRequest).toBe(1)
    expect(counts.preHandler).toBe(1)
  })

  it('still lets a plugin intercept a path no route and no controller owns', async () => {
    const counts = { onRequest: 0 }
    const runner = new PluginRunner()
    await runner.register({
      name: 'interceptor',
      register(app: TheoApp) {
        app.addHook('onRequest', (hookCtx) => {
          counts.onRequest++
          const r = hookCtx.response as unknown as ServerResponse
          r.writeHead(200)
          r.end(JSON.stringify({ intercepted: true }))
        })
      },
    })
    const middleware = createApiMiddleware(
      { ssrLoadModule: (p: string) => loadControllerWithSwc(p) } as unknown as never,
      SERVER_DIR,
      { pluginRunner: runner, csrfMode: 'off' },
    )
    const { res, body } = makeRes()
    await runMiddleware(middleware, makeReq('/api/docs'), res)

    expect(counts.onRequest).toBe(1)
    expect(JSON.parse(body())).toEqual({ intercepted: true })
  })
})
