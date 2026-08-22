/**
 * A middleware authored through the PUBLIC builder runs where the docs say to put it (#345).
 *
 * ## What was measured
 *
 * `packages/theo/README.md` tells you to write middleware with `middleware()` from
 * `theokit/server`, and to put it in `server/middleware/*.ts`. Neither half worked, and the second
 * measurement is sharper than the issue's:
 *
 * - the file-scan runner invokes `(req, res, next)` against Node's `IncomingMessage`, so a handler
 *   from the builder received `res` as its `next`;
 * - and `MiddlewareHandler` — the type the builder produces — had **zero runtime consumers**
 *   anywhere in the repository. It described a continuation pipeline (`next(request)` returning the
 *   downstream `Response`) that nothing implements, because the file-scan runner runs BEFORE
 *   routing and has no downstream response to hand back.
 *
 * So the published builder was dead API that the README documented as the way to write middleware.
 *
 * ## The contract that fits, and already runs
 *
 * `(request, context) => Response | void` — return a `Response` to short-circuit, return nothing to
 * continue. It is Web-standard, it needs no continuation, and `executeWebRequest` already runs
 * exactly this shape (`http/web-middleware-runner.ts`). Adopting it for the builder converges two
 * of the three contracts instead of adding a fourth.
 *
 * Nothing below is a fixture standing in for the runner: every assertion loads a real file through
 * the real `runMiddlewareAndContext`, which is what `tests/unit/middleware-composable.test.ts` — the
 * suite that existed while this was broken — never did.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import {
  runMiddlewareAndContext,
  _resetMiddlewareCacheForTests,
} from '../../packages/theo/src/server/http/middleware-runner.js'

/**
 * Fixtures live UNDER the repository root, not in `os.tmpdir()`, and that is load-bearing: the
 * runner loads them through the injected `loadModule`, and a `.ts` file outside the Vite root is
 * not transformed — it would fail to parse before reaching anything this file is about. The scanner
 * accepts `.ts/.tsx/.js/.jsx` only, so the extension is not free either.
 */
const FIXTURE_ROOT = join(process.cwd(), 'tests', '.tmp-middleware')

let serverDir: string

function writeMiddleware(name: string, source: string): void {
  mkdirSync(join(serverDir, 'middleware'), { recursive: true })
  writeFileSync(join(serverDir, 'middleware', name), source)
}

// No cache-busting query: each test gets its own `mkdtemp` directory, so two fixtures never share
// a path, and a query string is read by Vite's loader as a transform hint rather than as noise.
const loadModule = async (path: string): Promise<Record<string, unknown>> =>
  (await import(/* @vite-ignore */ pathToFileURL(path).href)) as Record<string, unknown>

function decodeChunk(chunk: unknown): string {
  if (chunk instanceof Uint8Array) return new TextDecoder().decode(chunk)
  return String(chunk)
}

/** A Node request/response pair, minimal but real enough for the runner's own checks. */
function nodePair(): { req: IncomingMessage; res: ServerResponse; written: string[] } {
  const written: string[] = []
  const req = {
    method: 'GET',
    url: '/api/thing',
    headers: { host: 'app.test', authorization: 'Bearer let-me-in' },
  } as unknown as IncomingMessage
  const res = {
    statusCode: 200,
    writableEnded: false,
    headersSent: false,
    setHeader() {},
    getHeader: () => undefined,
    // The short-circuit path writes a real `Response` back through
    // `writeWebResponseToServerResponse`, which sets the status line through `writeHead`.
    writeHead(status: number) {
      ;(this as { statusCode: number }).statusCode = status
      return this
    },
    // Decoded, because a real `Response` body arrives as bytes: `String(uint8Array)` yields the
    // comma-joined byte values, which would make this assertion pass or fail for the wrong reason.
    write(chunk: unknown) {
      written.push(decodeChunk(chunk))
      return true
    },
    end(chunk?: unknown) {
      if (chunk !== undefined) {
        written.push(decodeChunk(chunk))
      }
      ;(this as { writableEnded: boolean }).writableEnded = true
      return this
    },
  } as unknown as ServerResponse
  return { req, res, written }
}

beforeEach(() => {
  mkdirSync(FIXTURE_ROOT, { recursive: true })
  serverDir = mkdtempSync(join(FIXTURE_ROOT, 'server-'))
  _resetMiddlewareCacheForTests()
})

afterAll(() => {
  rmSync(FIXTURE_ROOT, { recursive: true, force: true })
})

describe('the builder from the README runs in server/middleware/', () => {
  it('test_a_builder_authored_middleware_reads_the_request_as_a_web_Request', async () => {
    writeMiddleware(
      '01-auth.ts',
      `import { middleware } from '../../../../packages/theo/src/server/define/index.js'
       export default middleware()
         .handle((request, context) => {
           // The exact call from the issue's repro: it used to throw
           // "request.headers.get is not a function" because \`request\` was Node's IncomingMessage.
           context.token = request.headers.get('authorization')
         })
         .build()`,
    )
    const { req, res } = nodePair()

    const result = await runMiddlewareAndContext(req, res, loadModule, serverDir)

    expect(result.aborted).toBe(false)
    expect((result.ctx as Record<string, unknown>).token).toBe('Bearer let-me-in')
  })

  it('test_returning_a_Response_short_circuits_and_is_written_to_the_client', async () => {
    writeMiddleware(
      '01-gate.ts',
      `import { middleware } from '../../../../packages/theo/src/server/define/index.js'
       export default middleware()
         .handle(() => new Response('nope', { status: 401 }))
         .build()`,
    )
    const { req, res, written } = nodePair()

    const result = await runMiddlewareAndContext(req, res, loadModule, serverDir)

    // Short-circuit means the route never runs AND the client gets the middleware's answer. A
    // runner that aborted without writing would leave a blank response, which is the failure this
    // whole issue is about.
    expect(result.aborted).toBe(true)
    expect(res.statusCode).toBe(401)
    expect(written.join('')).toBe('nope')
  })

  it('test_a_node_shaped_middleware_still_runs_unchanged', async () => {
    // The Express-style shape predates the builder and is what every existing app uses. Adopting a
    // Web contract for the builder must not evict it.
    writeMiddleware(
      '01-legacy.ts',
      `export default (req, res, next) => { req.headers['x-seen'] = '1'; next() }`,
    )
    const { req, res } = nodePair()

    const result = await runMiddlewareAndContext(req, res, loadModule, serverDir)

    expect(result.aborted).toBe(false)
    expect(req.headers['x-seen']).toBe('1')
  })

  it('test_a_plain_two_argument_function_is_not_mistaken_for_the_builder', async () => {
    // Preserved from `middleware-shape-refusal.test.ts`, whose subject this change resolved.
    // Dispatch is by what the builder MARKS, not by arity: a hand-written Node middleware that
    // ignores `next` also has length 2, and handing it a `Request` would break it.
    writeMiddleware('01-two-args.ts', `export default (req, res) => { req.headers['x-ran'] = '1' }`)
    const { req, res } = nodePair()

    const result = await runMiddlewareAndContext(req, res, loadModule, serverDir)

    expect(req.headers['x-ran']).toBe('1')
    // It never calls `next`, so the chain aborts — the pre-existing Node contract, unchanged.
    expect(result.aborted).toBe(true)
  })

  it('test_both_shapes_run_in_declared_filename_order', async () => {
    // Ordering is the reason the files are numbered. Running one shape before the other would make
    // `01-` and `02-` mean nothing whenever an app mixed them.
    writeMiddleware(
      '01-web.ts',
      `import { middleware } from '../../../../packages/theo/src/server/define/index.js'
       export default middleware().handle((request, context) => { context.order = ['web'] }).build()`,
    )
    writeMiddleware(
      '02-node.ts',
      `export default (req, res, next) => { req.headers['x-order'] = 'node-after-web'; next() }`,
    )
    const { req, res } = nodePair()

    const result = await runMiddlewareAndContext(req, res, loadModule, serverDir)

    expect((result.ctx as Record<string, unknown>).order).toEqual(['web'])
    expect(req.headers['x-order']).toBe('node-after-web')
  })
})
