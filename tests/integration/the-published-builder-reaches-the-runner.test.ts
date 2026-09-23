import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { BUILD_HOOK_TIMEOUT_MS, buildTheokitPackageOnce } from './_helpers/build-theokit-package.js'
import {
  _resetMiddlewareCacheForTests,
  runMiddlewareAndContext,
} from '../../packages/theo/src/server/http/middleware-runner.js'

/**
 * B-003, bullet 1: "a middleware authored with the public `middleware()` builder is invoked by the
 * file-scan runner **in a published build**."
 *
 * ## What already existed, and why neither half is this
 *
 * `tests/unit/middleware-builder-runs-in-the-file-scan.test.ts` drives the real runner against a
 * real file — and imports the builder from `src/`. So it proves the contract holds in the
 * repository, which is not what a consumer installs.
 *
 * `tests/smoke/import-validation.test.ts:125` reaches the built package and asserts
 * `typeof mod.middleware === 'function'`. So it proves the builder is EXPORTED from `dist`, which
 * is not the same as proving it can be USED: an export whose shape the runner cannot invoke is
 * exactly the defect this item was filed for. `095c786d1` shipped a refusal by name because that
 * had happened once already.
 *
 * The gap between them is the whole bullet: nothing had ever authored a middleware with the
 * `middleware()` that ships, put it where the README says, and watched the runner call it.
 *
 * ## Why the fixture is a `.js` file
 *
 * The existing unit test writes `.ts` fixtures under the repository root so Vite transforms them.
 * This one imports from `packages/theo/dist`, which is plain JavaScript — a `.ts` fixture importing
 * built `.js` would be transformed by Vite and prove a transform, not a build. A `.js` fixture is
 * loaded by Node as-is, which is what a consumer's `server/middleware/*.js` is. The scanner accepts
 * `.ts/.tsx/.js/.jsx`, so the extension costs nothing.
 */

const FIXTURE_ROOT = join(process.cwd(), 'tests', '.tmp-published-middleware')
const DIST_SERVER = join(process.cwd(), 'packages', 'theo', 'dist', 'server', 'index.js')

let serverDir: string

/** Load through Node's own resolver, the way the runner loads a consumer's file. */
const loadModule = async (path: string): Promise<Record<string, unknown>> =>
  (await import(/* @vite-ignore */ pathToFileURL(path).href)) as Record<string, unknown>

function writeMiddleware(name: string, source: string): void {
  mkdirSync(join(serverDir, 'middleware'), { recursive: true })
  writeFileSync(join(serverDir, 'middleware', name), source)
}

function nodePair(): { req: IncomingMessage; res: ServerResponse } {
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
    end() {},
    write() {
      return true
    },
  } as unknown as ServerResponse
  return { req, res }
}

beforeAll(() => {
  // The whole point is the built artifact, so the build is a precondition rather than a fixture.
  // The helper memoises the decision per process and serialises writers, so running it here does
  // not race the other suites that read `dist/`.
  buildTheokitPackageOnce()
  mkdirSync(FIXTURE_ROOT, { recursive: true })
  // `BUILD_HOOK_TIMEOUT_MS` rather than a number of my own: this repository already paid for that
  // mistake and recorded it — four `beforeAll`s that call this helper inherited vitest's 10s default
  // while the helper itself allows 240s for the build or for another worker's lock, so they passed
  // while `dist` was warm and started failing the moment parallelism let workers reach the lock
  // together. The budget is declared beside the build's own so the two cannot drift apart.
}, BUILD_HOOK_TIMEOUT_MS)

afterAll(() => {
  rmSync(FIXTURE_ROOT, { recursive: true, force: true })
})

beforeEach(() => {
  _resetMiddlewareCacheForTests()
  delete (globalThis as Record<string, unknown>).__b003_calls
  delete (globalThis as Record<string, unknown>).__b003_seen
  serverDir = mkdtempSync(join(FIXTURE_ROOT, 'server-'))
})

describe('the published middleware() builder is invoked by the file-scan runner (B-003)', () => {
  it('test_the_builder_that_ships_is_a_function', async () => {
    // Guards the premise of every assertion below. If `dist` does not export the builder at all,
    // the failures further down would name the runner while the cause was the build — and this
    // duplicates `import-validation.test.ts:125` deliberately, because that suite may be scoped
    // away from a run that includes this one.
    const mod = await loadModule(DIST_SERVER)
    expect(
      typeof mod.middleware,
      'packages/theo/dist/server/index.js does not export `middleware`. Every assertion below ' +
        'would fail for this reason rather than for the reason it names.',
    ).toBe('function')
  })

  it('test_a_middleware_authored_with_the_published_builder_is_actually_called', async () => {
    // The bullet. A consumer writes this file, with this import, in this location — and the runner
    // has to call it. Observability is a side effect on a module-scope array, because the runner
    // returns a context rather than the middleware's own value, and asserting on the return would
    // measure the runner's plumbing instead of whether the handler ran.
    writeMiddleware(
      'audit.js',
      `import { middleware } from ${JSON.stringify(pathToFileURL(DIST_SERVER).href)}
globalThis.__b003_calls = globalThis.__b003_calls ?? []
export default middleware('audit').handle((request) => {
  globalThis.__b003_calls.push(request?.method ?? 'no-request')
}).build()
`,
    )

    const { req, res } = nodePair()
    await runMiddlewareAndContext(req, res, loadModule, serverDir)

    // Observed through `globalThis`, NOT through a module export. Reading the array back off a
    // second `loadModule` would fail whenever the loader reevaluates the module — a different
    // instance of the array, empty, indistinguishable from a handler that never ran. The assertion
    // has to be able to fail for one reason only.
    expect(
      (globalThis as Record<string, unknown>).__b003_calls,
      'the file-scan runner did not invoke a middleware authored with the builder that SHIPS. ' +
        'The builder being exported from dist is not the same claim — an export whose shape the ' +
        'runner cannot invoke is the defect B-003 was filed for, and 095c786d1 shipped a refusal ' +
        'by name because it had already happened once.',
    ).toHaveLength(1)
  })

  it('test_the_handler_receives_a_request_rather_than_the_response_object', async () => {
    // The precise shape of the original defect, and the reason the bullet says "invoked" rather
    // than "loaded". Both the published and the file-scan shapes are functions, so a mismatch does
    // not throw — the handler was called with `res` where it expected `next`, and a handler reading
    // `request.method` got `undefined` from a ServerResponse. Asserting the METHOD landed is what
    // distinguishes "called" from "called with the wrong thing".
    writeMiddleware(
      'shape.js',
      `import { middleware } from ${JSON.stringify(pathToFileURL(DIST_SERVER).href)}
globalThis.__b003_seen = globalThis.__b003_seen ?? []
export default middleware('shape').handle((request) => {
  globalThis.__b003_seen.push(typeof request === 'object' && request !== null ? String(request.method) : 'not-a-request')
}).build()
`,
    )

    const { req, res } = nodePair()
    await runMiddlewareAndContext(req, res, loadModule, serverDir)

    expect(
      (globalThis as Record<string, unknown>).__b003_seen,
      'the handler ran but did not receive something request-shaped. This is the original defect ' +
        'exactly: both shapes are functions, so passing the wrong object throws nothing and the ' +
        'handler silently reads undefined off it.',
    ).toEqual(['GET'])
  })
})
