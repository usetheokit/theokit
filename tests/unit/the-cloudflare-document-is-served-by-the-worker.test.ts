/**
 * The worker must be the thing that answers `GET /`.
 *
 * Found by deploying, 2026-09-26 (B-263). The worker ran — `/api/health` returned
 * `{"status":"ok"}` in 0.54s with three of the six security headers on it — and `GET /` returned
 * **200, 529 bytes, an empty `<div id="root">`, and not one security header**, with
 * `ssrStreaming: true` set and `renderStreamingWeb` imported and bundled.
 *
 *     $ curl -sI https://theokit-b263-probe.…workers.dev/
 *     HTTP/2 200 · content-type: text/html · 529 bytes
 *     (no content-security-policy, no x-frame-options, no x-content-type-options)
 *
 *     $ curl -sI https://theokit-b263-probe.…workers.dev/api/health
 *     HTTP/2 200 · content-security-policy: … · x-frame-options: DENY
 *
 * ## The cause is in wrangler.toml, not in the worker
 *
 * Cloudflare's asset handler answers BEFORE the user Worker for any path that matches a file, and
 * `.theokit/client/index.html` matches `/`. So the document came off the CDN as a static shell and
 * the worker was never invoked for it — which is also why it carried no headers: the code that adds
 * them did not run. `run_worker_first` is the switch that inverts that precedence, and the generated
 * toml did not set it.
 *
 * ## Why no earlier gate saw it
 *
 * Every existing assertion about this path reads the GENERATED TEXT. `cloudflare-streaming-shell`
 * even executes the worker — and executing the worker cannot observe that the platform never calls
 * it. The precedence lives in `wrangler.toml` and is a property of Cloudflare's request routing, so
 * `wrangler deploy --dry-run` (exit 0 on the bundle that produced this) cannot see it either.
 *
 * ## What is asserted, and where
 *
 * Two halves, deliberately in two shapes:
 *
 * - The toml is a CONFIG FILE. Its text is the artifact Cloudflare reads, so the text is what is
 *   asserted — there is no behaviour underneath it to execute.
 * - Owning `/` means also receiving `/robots.txt` and `/logo.png`, which must NOT be rendered as
 *   documents. That is behaviour, and it is proved by running the worker against a real `Request`
 *   with a stub `ASSETS` binding that counts its own calls.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterAll, describe, expect, it } from 'vitest'

import {
  renderCloudflareWorkerEntry,
  renderWranglerToml,
} from '../../packages/theo/src/adapters/cloudflare.js'

const HEAD = '<!doctype html><html><head><title>t</title></head><body><div id="root">'
const TAIL = '</div><script type="module" src="/entry-client.js"></script></body></html>'

describe('the generated wrangler.toml gives the worker the document', () => {
  it('test_run_worker_first_routes_the_document_to_the_worker', () => {
    const toml = renderWranglerToml({ ssrStreaming: true })

    // Without this key the asset handler answers `/` off the CDN and the worker is never invoked,
    // which is the measured defect: a 200 with an empty root and no headers.
    expect(
      toml,
      'wrangler.toml does not set run_worker_first, so Cloudflare answers `/` from the asset ' +
        'handler and the worker never sees the document request',
    ).toMatch(/^run_worker_first = /m)
    expect(toml).toContain('"/*"')
  })

  it('test_the_hashed_asset_directory_is_excluded_from_the_worker', () => {
    // COUNTERPROOF for the case above: `run_worker_first = true` satisfies it and sends all 307
    // built assets through the worker, paying a JS invocation per stylesheet and chunk. The
    // negation is what keeps the CDN path for the files that have no reason to leave it.
    const toml = renderWranglerToml({ ssrStreaming: true })

    expect(toml).toMatch(/"!\/assets\/\*"/)
  })

  it('test_streaming_lets_the_worker_own_the_deep_link', () => {
    // With the worker rendering SSR for every extension-less path, an asset MISS is a genuine 404.
    // Leaving `single-page-application` here would make `/nope.png` answer 200 with HTML.
    const toml = renderWranglerToml({ ssrStreaming: true })

    expect(toml).toContain('not_found_handling = "none"')
  })

  it('test_streaming_off_keeps_the_spa_fallback', () => {
    // COUNTERPROOF for the case above, and the one that pins the flag as the gate. With streaming
    // off the worker does NOT render deep links — it forwards them to ASSETS — so the asset
    // handler's SPA fallback is the only thing that makes `/dashboard` boot at all. A fix that
    // hardcoded `"none"` would 404 every deep link on that path and pass every other case here.
    const toml = renderWranglerToml({ ssrStreaming: false })

    expect(toml).toContain('not_found_handling = "single-page-application"')
    expect(toml).not.toContain('not_found_handling = "none"')
  })

  it('test_the_worker_owns_the_document_on_both_paths', () => {
    // The security-header promise the build prints is unqualified — "on every response cloudflare
    // returns". With streaming off the worker still has to be the one answering `/`, or the shell
    // comes off the CDN bare exactly as it did here.
    expect(renderWranglerToml({ ssrStreaming: false })).toMatch(/^run_worker_first = /m)
  })

  it('test_no_argument_still_renders_a_toml', () => {
    // The only caller passes `config.ssrStreaming`, which the schema defaults to `false` — but the
    // function is exported and was argument-less before. An absent argument must not throw.
    expect(renderWranglerToml()).toContain('[assets]')
  })
})

/**
 * The half that has to be run rather than read.
 *
 * A static file arriving at a worker that renders SSR for everything would be answered with the
 * document shell: `/logo.png` returning HTML with `content-type: text/html`. No textual assertion
 * distinguishes that from the fix, because both emit the same renderer call — what differs is which
 * branch a given pathname takes, and only executing it can say.
 *
 * The stub `ASSETS` binding counts its own calls for the reason the neighbouring file states in its
 * own words: an assertion about a response body is vacuous if the branch under test was never taken.
 */
describe('the worker separates a document request from a static file', () => {
  const root = mkdtempSync(join(tmpdir(), 'theokit-cf-doc-'))
  let counter = 0

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  interface Seen {
    readonly ssrCalls: number
    readonly assetCalls: number
    readonly assetPaths: readonly string[]
  }

  async function loadWorker(): Promise<{
    fetch: (r: Request) => Promise<Response>
    seen: () => Seen
  }> {
    counter += 1
    const dir = join(root, `entry-${String(counter)}`)
    mkdirSync(dir, { recursive: true })

    const stub = join(dir, 'server.mjs')
    writeFileSync(
      stub,
      `export let ssrCalls = 0
export const assetPaths = []
export const matchRoute = () => null
export const compilePattern = () => ({})
export const executeRoute = () => {}
export const createProductionLoader = () => () => ({})
export const createWebShim = () => ({ req: {}, res: { setHeader() {}, statusCode: 200 }, toResponse: () => new Response('route') })
export const buildSecurityHeaders = () => ({})
export const withSecurityHeaders = (r) => r
export const generateNonce = () => 'n'
export const createCloudflareWsBridge = () => ({ handle: () => new Response(null) })
export const extractTraceIdFromRequest = () => 't'
export const TRACE_HEADER = 'x-trace-id'
export const createCorsWebHandler = () => null
export const createPluginRunnerFromConfig = async () => undefined
export const resolveTransformer = (s) => ({ name: s })
export const mountAgent = async () => new Response('agent')
export const resolveProvider = () => ({ apiKey: 'sk-test' })
export const scanAgents = () => []
export const renderStreamingWeb = async (request, options = {}) => {
  ssrCalls += 1
  return new Response((options.htmlHead ?? '') + (options.htmlTail ?? ''), {
    headers: { 'content-type': 'text/html' },
  })
}
`,
      'utf8',
    )

    const entry = renderCloudflareWorkerEntry({
      ssrStreaming: true,
      htmlHead: HEAD,
      htmlTail: TAIL,
    })
    const file = join(dir, 'worker.mjs')
    writeFileSync(
      file,
      entry
        .replace(
          /^(\s*import[^\n]*?from\s+)'(?!node:|\.)[^']*'/gmu,
          `$1'${pathToFileURL(stub).href}'`,
        )
        .replace(
          /^(\s*import[^\n]*?from\s+)'\.\.\/server\/entry-server\.js'/gmu,
          `$1'${pathToFileURL(stub).href}'`,
        ),
      'utf8',
    )

    const mod = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as {
      default: { fetch: (r: Request, e: unknown, c: unknown) => Promise<Response> }
    }
    const probe = (await import(/* @vite-ignore */ pathToFileURL(stub).href)) as {
      ssrCalls: number
      assetPaths: string[]
    }

    // The binding Cloudflare injects. `fetch` records the path so a case can prove WHICH request
    // reached the asset handler, not merely that one did.
    const env = {
      ASSETS: {
        fetch: (request: Request): Response => {
          probe.assetPaths.push(new URL(request.url).pathname)
          return new Response('static', { headers: { 'content-type': 'image/png' } })
        },
      },
    }

    return {
      fetch: (r: Request) => mod.default.fetch(r, env, {}),
      seen: () => ({
        ssrCalls: probe.ssrCalls,
        assetCalls: probe.assetPaths.length,
        assetPaths: [...probe.assetPaths],
      }),
    }
  }

  it('test_the_root_path_is_rendered_by_the_worker', async () => {
    const worker = await loadWorker()
    const response = await worker.fetch(new Request('https://app.test/'))

    expect(worker.seen().ssrCalls, 'the document was not rendered by the worker').toBe(1)
    expect(worker.seen().assetCalls, 'the document was served as a static file').toBe(0)
    expect(await response.text()).toContain('<head>')
  })

  it('test_an_extensionless_route_is_rendered_by_the_worker', async () => {
    // `/dashboard` is no file, and with `not_found_handling = "none"` nothing else will answer it.
    const worker = await loadWorker()
    await worker.fetch(new Request('https://app.test/dashboard'))

    expect(worker.seen().ssrCalls).toBe(1)
    expect(worker.seen().assetCalls).toBe(0)
  })

  it('test_a_root_static_file_goes_to_the_asset_binding', async () => {
    // `run_worker_first = ["/*", "!/assets/*"]` hands `/robots.txt` to the worker. Rendering it as
    // a document would answer a text file with HTML — the defect the fix would introduce if it
    // only inverted the precedence and stopped there.
    const worker = await loadWorker()
    const response = await worker.fetch(new Request('https://app.test/robots.txt'))

    expect(worker.seen().ssrCalls, '/robots.txt was rendered as a document').toBe(0)
    expect(worker.seen().assetPaths).toEqual(['/robots.txt'])
    expect(response.headers.get('content-type')).toBe('image/png')
  })

  it('test_a_hashed_chunk_arriving_at_the_worker_is_not_rendered', async () => {
    // Belt and braces: the toml excludes `/assets/*`, and a stale deployed toml, a preview URL or
    // a future negation typo would send one here anyway. Answering a JS chunk with HTML breaks
    // hydration in a way whose symptom names neither cause.
    const worker = await loadWorker()
    await worker.fetch(new Request('https://app.test/assets/index-abc123.js'))

    expect(worker.seen().ssrCalls).toBe(0)
    expect(worker.seen().assetPaths).toEqual(['/assets/index-abc123.js'])
  })

  it('test_an_api_route_is_unaffected_by_the_split', async () => {
    // COUNTERPROOF for all five: a worker that answered everything from ASSETS would pass the two
    // static cases and break the half that already worked in production. `/api/health` was the ONE
    // thing measured as correct on the live deploy, so it is the regression to guard.
    const worker = await loadWorker()
    await worker.fetch(new Request('https://app.test/api/health'))

    expect(worker.seen().ssrCalls).toBe(0)
    expect(worker.seen().assetCalls).toBe(0)
  })
})
