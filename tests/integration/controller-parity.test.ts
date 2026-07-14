import 'reflect-metadata'

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { join, resolve } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { loadControllerWithSwc } from '../../packages/http/dist/index.js'
import { createApiMiddleware } from '../../packages/theo/src/vite-plugin/api-middleware.js'
import { emitClientDts } from '../../packages/theo/src/vite-plugin/app-typed-client.js'

/**
 * #122 Phase 3 (T3.1) — end-to-end parity gate ("eat your own cooking"). ONE
 * decorator controller is BOTH served through the real `api-middleware` (scan →
 * swc → dispatch fall-through) AND surfaced typed in `.theokit/client.d.ts` — the
 * full chain a `theokit dev` user hits. The fixture lives under `packages/theo/`
 * so the swc-compiled controller's bare imports (`@theokit/http`, `zod`) resolve.
 *
 * A real Vite dev server / browser boot is not runnable in this environment, so
 * the dev-server pipeline is exercised via its real seams: `createApiMiddleware`
 * with a Vite-shaped stub whose `ssrLoadModule` is `loadControllerWithSwc` (what
 * the Task 1.1 transform + real `ssrLoadModule` produce together).
 */
const TEST_ROOT = resolve(__dirname, '../../packages/theo/__controller_parity_e2e__')
const SERVER_DIR = join(TEST_ROOT, 'server')
const DIST_DIR = join(TEST_ROOT, '.theokit')

const CONTROLLER_SRC = `
import 'reflect-metadata'
import { z } from 'zod'
import { Controller, Get, Post, Body, Param } from '@theokit/http'

const zCreate = z.object({ title: z.string().min(3) })
const store = [{ id: 1, title: 'seed' }]
let nextId = 2

@Controller('api/v2/things')
export class ThingsController {
  @Get(':id')
  findById(@Param('id') id: string) {
    return store.find((t) => t.id === Number(id))
  }

  @Post()
  create(@Body(zCreate) body: z.infer<typeof zCreate>) {
    const t = { id: nextId++, title: body.title }
    store.push(t)
    return t
  }
}
`

interface ViteLike {
  ssrLoadModule: (path: string) => Promise<Record<string, unknown>>
}

// The dev api-middleware loads controllers via `vite.ssrLoadModule`; here that is
// `loadControllerWithSwc` (swc-compiles the parameter decorators, exactly what the
// Task 1.1 Vite transform enables in a real dev server).
function makeVite(): ViteLike {
  return { ssrLoadModule: (p: string) => loadControllerWithSwc(p) }
}

function makeReq(opts: { method?: string; url?: string; body?: string }): IncomingMessage {
  const chunks = opts.body ? [Buffer.from(opts.body, 'utf-8')] : []
  const stream = Readable.from(chunks) as unknown as IncomingMessage
  stream.method = opts.method ?? 'GET'
  stream.url = opts.url ?? '/api/test'
  stream.headers = { host: 'localhost:3000', 'content-type': 'application/json' }
  return stream
}

interface CapturingRes {
  res: ServerResponse
  status(): number
  body(): string
}

function makeRes(): CapturingRes {
  let status = 0
  let body = ''
  let ended = false
  const headers: Record<string, string | number | string[]> = {}
  const res = {
    statusCode: 200,
    headersSent: false,
    get writableEnded(): boolean {
      return ended
    },
    writeHead(s: number, h?: Record<string, string | number>): ServerResponse {
      status = s
      ;(res as unknown as { statusCode: number }).statusCode = s
      if (h) Object.assign(headers, h)
      return res as unknown as ServerResponse
    },
    setHeader(name: string, value: string | number | string[]): ServerResponse {
      headers[name] = value
      return res as unknown as ServerResponse
    },
    // eslint-disable-next-line sonarjs/function-return-type -- mirrors Node ServerResponse.getHeader
    getHeader(name: string): string | number | string[] | undefined {
      return headers[name]
    },
    end(b?: string): void {
      if (b) body += b
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
  return new Promise((resolvePromise) => {
    let settled = false
    const done = (): void => {
      if (settled) return
      settled = true
      clearInterval(check)
      resolvePromise()
    }
    middleware(req, res, done)
    const check = setInterval(() => {
      if ((res as unknown as { writableEnded: boolean }).writableEnded) done()
    }, 5)
    setTimeout(done, 2500)
  })
}

beforeAll(() => {
  mkdirSync(join(SERVER_DIR, 'controllers'), { recursive: true })
  writeFileSync(join(SERVER_DIR, 'controllers', 'things.controller.ts'), CONTROLLER_SRC, 'utf-8')
})

afterAll(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true })
})

describe('#122 controller ↔ file-based parity — end-to-end', () => {
  it('serves a decorator controller through the real api-middleware (POST → 201, @Param bind)', async () => {
    const middleware = createApiMiddleware(makeVite() as never, SERVER_DIR, { csrfMode: 'off' })

    const postRes = makeRes()
    await runMiddleware(
      middleware,
      makeReq({
        method: 'POST',
        url: '/api/v2/things',
        body: JSON.stringify({ title: 'ship it' }),
      }),
      postRes.res,
    )
    expect(postRes.status()).toBe(201)
    expect(JSON.parse(postRes.body()).title).toBe('ship it')

    const getRes = makeRes()
    await runMiddleware(middleware, makeReq({ url: '/api/v2/things/1' }), getRes.res)
    expect(getRes.status()).toBe(200)
    expect(JSON.parse(getRes.body()).id).toBe(1)
  })

  it('surfaces the SAME controller in the typed client (.theokit/client.d.ts)', async () => {
    const { path } = await emitClientDts({
      cwd: TEST_ROOT,
      serverDir: SERVER_DIR,
      distDir: DIST_DIR,
    })
    const dts = readFileSync(path, 'utf-8')
    expect(dts).toContain('things: {')
    expect(dts).toMatch(/\bget:/)
    expect(dts).toMatch(/\bpost:/)
    expect(dts).toContain('Awaited<ReturnType<') // response inference (ADR-2)
    expect(dts).toContain('params: { id: string }')
  })
})
