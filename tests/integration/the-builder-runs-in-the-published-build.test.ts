import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { BUILD_HOOK_TIMEOUT_MS, buildTheokitPackageOnce } from './_helpers/build-theokit-package.js'

/**
 * B-003, bullet 1 — *"a middleware authored with the public `middleware()` builder is invoked by
 * the file-scan runner **in a published build**"*.
 *
 * `tests/unit/middleware-builder-runs-in-the-file-scan.test.ts` closes bullet 2 and imports
 * `../../packages/theo/src/...`. That is one module graph: the builder that writes the brand and
 * the runner that reads it are the same instance of the same module, and they cannot disagree.
 * A consumer never has that. It writes
 *
 * ```js
 * import { middleware } from 'theokit/server/define'
 * ```
 *
 * which the export map sends to `dist/server/define/index.js`, while the runner arrives through
 * `dist/server/http/index.js` — two published entries, resolved separately, whose common code tsup
 * is free to place in one shared chunk or in two copies.
 *
 * ## Why that gap is the one #345 lives in
 *
 * The two halves recognise each other by a brand, and `define-middleware.ts:75` makes it a
 * REGISTERED symbol — `Symbol.for('theokit.middleware.web-shaped')` — written onto the function by
 * `Object.defineProperty`. Both choices are load-bearing in a bundle and invisible in source:
 *
 * - a plain `Symbol()` would still pass every source test, and produce two unequal symbols the
 *   moment the bundler gives each entry its own copy of the module. `middleware-runner.ts:173` is
 *   `WEB_SHAPED_MIDDLEWARE in mw`, so the runner would read every builder-authored middleware as
 *   Node-shaped and hand it an `IncomingMessage` — which is #345's original symptom, verbatim;
 * - the brand is a side-effectful property write on a returned function, the shape a minifier is
 *   most willing to drop.
 *
 * Measured on this build (2026-09-22): `dist/server/define/index.js` reaches 4 chunks and
 * `dist/server/http/index.js` reaches 17, and today exactly one chunk carrying the brand is common
 * to both. A second copy of it already exists elsewhere in `dist/`, reached by another entry — so
 * the duplication this guards against is not hypothetical, it simply does not fall between these
 * two entries yet. Nothing pins that, which is the point: this test asserts the BEHAVIOUR through
 * the published entries and never a chunk layout, because the layout is tsup's to change.
 *
 * ## What it does not cover
 *
 * The tarball. This consumes `dist/`, which is what `files` publishes, but a packing mistake —
 * an entry excluded by `.npmignore`, an `exports` path that does not ship — would pass here.
 * `tests/smoke/import-validation.test.ts` covers artifact presence; this covers execution.
 */

const REPO = resolve(__dirname, '../..')
const THEO = resolve(REPO, 'packages/theo')

/**
 * Resolve a published subpath the way a consumer's runtime does — through the package's own
 * `exports` map — rather than by spelling `dist/...` here. A hardcoded path keeps passing after the
 * map stops listing the subpath, which is the half of "published" a file check cannot see.
 */
function resolvePublished(subpath: string): string {
  const pkg = JSON.parse(readFileSync(join(THEO, 'package.json'), 'utf8')) as {
    exports: Record<string, { import?: string }>
  }
  const entry = pkg.exports[subpath]
  if (entry?.import === undefined) {
    throw new Error(
      `theokit does not publish "${subpath}" — the exports map has no import condition`,
    )
  }
  return resolve(THEO, entry.import)
}

/** Fixtures live under the repo root for the same reason the unit test's do — see its header. */
const FIXTURE_ROOT = join(REPO, 'tests', '.tmp-published-middleware')

let serverDir: string
let publishedDefine: string
let resetCache: () => void
let runMiddlewareAndContext: (
  req: IncomingMessage,
  res: ServerResponse,
  load: (path: string) => Promise<Record<string, unknown>>,
  dir: string,
) => Promise<{ aborted: boolean; ctx: unknown }>

const loadModule = async (path: string): Promise<Record<string, unknown>> =>
  (await import(/* @vite-ignore */ pathToFileURL(path).href)) as Record<string, unknown>

function writeMiddleware(name: string, source: string): void {
  mkdirSync(join(serverDir, 'middleware'), { recursive: true })
  writeFileSync(join(serverDir, 'middleware', name), source)
}

/** A Node pair minimal but real enough for the runner's own checks. */
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
    writeHead(status: number) {
      ;(this as { statusCode: number }).statusCode = status
      return this
    },
    write(chunk: unknown) {
      written.push(chunk instanceof Uint8Array ? new TextDecoder().decode(chunk) : String(chunk))
      return true
    },
    end(chunk?: unknown) {
      if (chunk !== undefined) {
        written.push(chunk instanceof Uint8Array ? new TextDecoder().decode(chunk) : String(chunk))
      }
      ;(this as { writableEnded: boolean }).writableEnded = true
      return this
    },
  } as unknown as ServerResponse
  return { req, res, written }
}

describe('the published builder is invoked by the published runner (B-003)', () => {
  beforeAll(async () => {
    buildTheokitPackageOnce()
    publishedDefine = resolvePublished('./server/define')
    const http = (await import(
      /* @vite-ignore */ pathToFileURL(resolvePublished('./server/http')).href
    )) as Record<string, unknown>
    runMiddlewareAndContext = http.runMiddlewareAndContext as typeof runMiddlewareAndContext
    resetCache = http._resetMiddlewareCacheForTests as () => void
  }, BUILD_HOOK_TIMEOUT_MS)

  // One directory PER TEST, and the cache cleared with it. The runner memoises the scanned chain
  // per server dir, and both halves of that matter: a shared directory would also leave the
  // previous case's file in the scan, so a later assertion would be about two middlewares.
  beforeEach(() => {
    mkdirSync(FIXTURE_ROOT, { recursive: true })
    serverDir = mkdtempSync(join(FIXTURE_ROOT, 'server-'))
    resetCache()
  })

  afterAll(() => {
    rmSync(FIXTURE_ROOT, { recursive: true, force: true })
  })

  it('test_both_halves_come_from_the_published_entries_and_not_from_src', () => {
    // Guards the check itself. If either path fell back to `src/`, every assertion below would be
    // re-running the unit test under a different name — a green run that measured nothing.
    expect(publishedDefine).toMatch(/[/\\]dist[/\\]/)
    expect(publishedDefine).not.toMatch(/[/\\]src[/\\]/)
    expect(typeof runMiddlewareAndContext).toBe('function')
  })

  it('test_a_builder_authored_middleware_is_INVOKED_and_reads_a_web_Request', async () => {
    writeMiddleware(
      '01-auth.js',
      `import { middleware } from ${JSON.stringify(pathToFileURL(publishedDefine).href)}
       export default middleware()
         .handle((request, context) => {
           // The issue's repro. Node's IncomingMessage has no \`headers.get\`, so a runner that
           // failed to recognise the brand would throw here instead of reading the header.
           context.token = request.headers.get('authorization')
         })
         .build()`,
    )
    const { req, res } = nodePair()

    const result = await runMiddlewareAndContext(req, res, loadModule, serverDir)

    expect(result.aborted).toBe(false)
    expect((result.ctx as Record<string, unknown>).token).toBe('Bearer let-me-in')
  })

  it('test_the_brand_survives_the_build_as_a_REGISTERED_symbol', async () => {
    // The mechanism the case above depends on, asserted directly so a failure says WHICH half
    // broke. `Symbol.for` is what lets a second copy of the module agree with the first; a plain
    // `Symbol()` is indistinguishable from it in src and fatal across two bundle chunks.
    const define = (await import(/* @vite-ignore */ pathToFileURL(publishedDefine).href)) as {
      middleware: () => { handle: (f: unknown) => { build: () => object } }
    }
    const built = define
      .middleware()
      .handle(() => undefined)
      .build()

    expect(Symbol.for('theokit.middleware.web-shaped') in built).toBe(true)
  })

  it('test_returning_a_Response_short_circuits_through_the_published_runner', async () => {
    writeMiddleware(
      '02-gate.js',
      `import { middleware } from ${JSON.stringify(pathToFileURL(publishedDefine).href)}
       export default middleware()
         .handle(() => new Response('denied', { status: 403 }))
         .build()`,
    )
    const { req, res, written } = nodePair()

    const result = await runMiddlewareAndContext(req, res, loadModule, serverDir)

    expect(result.aborted).toBe(true)
    expect(res.statusCode).toBe(403)
    expect(written.join('')).toContain('denied')
  })
})
