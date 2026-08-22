import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { IncomingMessage, ServerResponse } from 'node:http'

import {
  runMiddlewareAndContext,
  _resetMiddlewareCacheForTests,
} from '../../packages/theo/src/server/http/middleware-runner.js'
import { middleware } from '../../packages/theo/src/server/define/middleware-builder.js'
import type { LoadModule } from '../../packages/theo/src/server/scan/module-loader.js'

/**
 * B-003 / usetheokit/theokit#345 — the published `middleware()` builder produces
 * a handler the file-scan runner cannot invoke, and the failure is silent.
 *
 * The builder resolves to `(request: Request, next: (request) => Promise<Response>) => Response`.
 * The Node runner invokes `mw(req, res, next)` against
 * `(req: IncomingMessage, res: ServerResponse, next: () => void) => void`. Both
 * are functions, so the `typeof mw !== 'function'` screen passes and the handler
 * is called with `request = req` and `next = res`.
 *
 * What follows is the part worth a test. If the middleware calls `next(request)`
 * it is calling `res(...)` and gets a TypeError from inside framework code; if
 * it simply returns a `Response`, the runner observes that its own `next` was
 * never called, aborts the request, and writes nothing. A blank response and a
 * middleware that looks correct.
 *
 * The convergence of the three middleware contracts in this repository — the
 * published one, the Node runner's, and `WebMiddleware` — is a design decision
 * nobody has taken (`web-middleware-runner.ts` records it as deferred). Until it
 * is taken, refusing by name is the honest behaviour: the same discipline the
 * route scanner applies to `[[...slug]]`.
 */

let serverDir: string

const req = {} as IncomingMessage
const res = { writableEnded: false } as ServerResponse

beforeEach(() => {
  serverDir = mkdtempSync(join(tmpdir(), 'theo-mw-shape-'))
  mkdirSync(join(serverDir, 'middleware'), { recursive: true })
  _resetMiddlewareCacheForTests()
})

afterEach(() => {
  rmSync(serverDir, { recursive: true, force: true })
  _resetMiddlewareCacheForTests()
})

/** Registers one middleware file on disk and serves the given module for it. */
function loaderFor(fileName: string, mod: Record<string, unknown>): LoadModule {
  writeFileSync(join(serverDir, 'middleware', fileName), '// shape decided by the loader')
  return () => Promise.resolve(mod)
}

describe('the runner refuses a middleware shape it cannot invoke (B-003)', () => {
  it('test_a_builder_produced_middleware_is_refused_by_name', async () => {
    const built = middleware()
      .handle((_request, next) => next(_request))
      .build()
    const loadModule = loaderFor('01-auth.ts', { default: built })

    // Named: the file, the shape it declares, and the shape this runner invokes.
    // A message that only said "invalid middleware" would leave the author with
    // a working-looking file and no way to tell why.
    await expect(runMiddlewareAndContext(req, res, loadModule, serverDir)).rejects.toThrow(
      /01-auth\.ts/,
    )
    await expect(runMiddlewareAndContext(req, res, loadModule, serverDir)).rejects.toThrow(
      /middleware\(\)|Request/,
    )
  })

  it('test_a_node_shaped_middleware_still_runs', async () => {
    let ran = false
    const loadModule = loaderFor('01-node.ts', {
      default: (_q: IncomingMessage, _s: ServerResponse, next: () => void) => {
        ran = true
        next()
      },
    })

    const result = await runMiddlewareAndContext(req, res, loadModule, serverDir)

    // The refusal must cost the working path nothing — this is the shape every
    // middleware in the wild has today.
    expect(ran).toBe(true)
    expect(result.aborted).toBe(false)
  })

  it('test_a_plain_two_argument_function_is_not_mistaken_for_the_builder', async () => {
    // Detection is by what the builder marks, not by arity. A hand-written Node
    // middleware that ignores `next` has length 2 and must keep working, or the
    // refusal would break more than it protects.
    let ran = false
    const loadModule = loaderFor('01-two-args.ts', {
      default: (_q: IncomingMessage, _s: ServerResponse) => {
        ran = true
      },
    })

    const result = await runMiddlewareAndContext(req, res, loadModule, serverDir)

    expect(ran).toBe(true)
    // It never calls `next`, so the chain aborts — the pre-existing contract,
    // unchanged by this refusal.
    expect(result.aborted).toBe(true)
  })
})
