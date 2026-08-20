import { describe, it, expect, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { generateEntryServer } from '../../packages/theo/src/router/entry-server.js'

// The existing coverage for this generator asserts `toContain` over the emitted
// template string. A string can contain every expected token and still be a module
// that throws on its first statement — which is exactly how usetheokit/theokit#344
// shipped. So this suite EXECUTES the generated entry against a real `Request`.
//
// Only the module's imports are stubbed, never its body: the generated code under
// test runs verbatim. React itself stays real, because the app tree is built from
// `React.createElement`.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

// Inside node_modules/.cache: bare specifiers still resolve by walking up to the
// repo's node_modules, and the directory is already ignored — a temp dir at the
// repo root would dirty a shared working tree if a test failed before cleanup.
const CACHE = join(REPO_ROOT, 'node_modules', '.cache')
const created: string[] = []

afterAll(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true })
})

function materialize(code: string): string {
  const runnable = code
    .replace(
      "import { renderToPipeableStream, renderToReadableStream } from 'react-dom/server'",
      [
        // Faithful enough to drive the Node path: React calls `onShellReady`,
        // and `pipe(dest)` writes the app markup and ends the destination, which
        // is what makes the tail observable at all.
        'const renderToPipeableStream = (app, opts) => {',
        '  queueMicrotask(() => opts.onShellReady && opts.onShellReady())',
        "  return { pipe(dest) { dest.end('<span>app</span>') }, abort() {} }",
        '}',
        'const renderToReadableStream = async () =>',
        '  new ReadableStream({ start(controller) { controller.close() } })',
      ].join('\n'),
    )
    .replace(
      "import { createStaticHandler, createStaticRouter, StaticRouterProvider, matchRoutes } from 'react-router'",
      [
        'const createStaticHandler = () => ({ dataRoutes: [], query: async () => ({}) })',
        'const createStaticRouter = () => ({})',
        'const StaticRouterProvider = () => null',
        'const matchRoutes = () => []',
      ].join('\n'),
    )
    .replace(
      "import { routes, __theoPreloadMap, __theoPreloadPathsFor } from '/@theo/route-manifest'",
      [
        'const routes = []',
        'const __theoPreloadMap = {}',
        'const __theoPreloadPathsFor = () => []',
      ].join('\n'),
    )

  mkdirSync(CACHE, { recursive: true })
  const dir = mkdtempSync(join(CACHE, 'theo-entry-exec-'))
  created.push(dir)
  const file = join(dir, 'entry-server.mjs')
  writeFileSync(file, runnable)
  return file
}

const HEAD = '<!doctype html><html><head><title>t</title></head><body><div id="root">'
const TAIL = '</div><script type="module" src="/entry-client.js"></script></body></html>'

describe('the generated streaming web entry actually runs (usetheokit/theokit#344)', () => {
  it('returns a Response instead of throwing on a real Request', async () => {
    const file = materialize(generateEntryServer({ streaming: true }))
    const mod = await import(pathToFileURL(file).href)

    // Every Web-target adapter calls exactly this: renderStreamingWeb(request).
    const response = await mod.renderStreamingWeb(new Request('http://localhost/docs?page=2'))

    expect(response).toBeInstanceOf(Response)
    expect(response.status).toBe(200)
  })
})

/**
 * usetheokit/theokit#343 — with `ssrStreaming: true` the renderers returned
 * React's raw output and nothing else: no `<html>`, no `<head>`, and none of the
 * hydration data the client router reads before it boots. The single-shot
 * `render()` never had the problem because it returns `{ html, hydrationData }`
 * for the caller to place inside the template; the streaming siblings returned a
 * stream with nowhere for the caller to intervene.
 *
 * The document is asserted over the response BODY, not over the emitted module
 * text. `toContain` on the generator's output is what let #344 ship a module
 * that threw on its first statement.
 */
describe('the streamed document is a document (usetheokit/theokit#343)', () => {
  it('test_the_streamed_body_carries_the_head_and_the_hydration_data_script', async () => {
    const file = materialize(generateEntryServer({ streaming: true }))
    const mod = await import(pathToFileURL(file).href)

    const response = await mod.renderStreamingWeb(new Request('http://localhost/docs'), {
      htmlHead: HEAD,
      htmlTail: TAIL,
    })
    const body = await response.text()

    expect(body).toContain('<head>')
    expect(body).toContain('<div id="root">')
    expect(body).toContain('window.__staticRouterHydrationData')
    // The hydration script must precede the client entry, or the router reads
    // an undefined global and re-fetches everything the server already sent.
    expect(body.indexOf('__staticRouterHydrationData')).toBeLessThan(body.indexOf('entry-client'))
  })

  it('test_the_first_chunk_carries_the_head_rather_than_the_whole_buffered_document', async () => {
    const file = materialize(generateEntryServer({ streaming: true }))
    const mod = await import(pathToFileURL(file).href)

    const response = await mod.renderStreamingWeb(new Request('http://localhost/docs'), {
      htmlHead: HEAD,
      htmlTail: TAIL,
    })

    const reader = response.body.getReader()
    const first = await reader.read()
    await reader.cancel()

    // Observed chunk-by-chunk on purpose: a `<head>` present only in the fully
    // buffered body is the defect this streams to avoid, not evidence against it.
    expect(new TextDecoder().decode(first.value)).toContain('<head>')
  })

  it('test_a_nonce_reaches_the_hydration_script_like_it_reaches_the_others', async () => {
    const file = materialize(generateEntryServer({ streaming: true }))
    const mod = await import(pathToFileURL(file).href)

    const response = await mod.renderStreamingWeb(new Request('http://localhost/docs'), {
      htmlHead: HEAD,
      htmlTail: TAIL,
      nonce: 'abc123',
    })

    expect(await response.text()).toContain(
      '<script nonce="abc123">window.__staticRouterHydrationData',
    )
  })

  it('test_a_caller_that_passes_no_template_still_gets_the_hydration_data', async () => {
    // Web adapters do not hand the worker its index.html yet. Until they do,
    // degrading to "no document at all" would be worse than degrading to "app
    // markup plus the data the client needs".
    const file = materialize(generateEntryServer({ streaming: true }))
    const mod = await import(pathToFileURL(file).href)

    const response = await mod.renderStreamingWeb(new Request('http://localhost/docs'))

    expect(await response.text()).toContain('window.__staticRouterHydrationData')
  })
})

/**
 * The Node streaming path is the one `theo start` actually serves, so it gets
 * the same treatment: the generated module runs, and the assertion is over the
 * bytes written to the response.
 */
describe('the streamed Node document is a document (usetheokit/theokit#343)', () => {
  it('test_the_node_renderer_writes_head_then_app_then_hydration_then_tail', async () => {
    const file = materialize(generateEntryServer({ streaming: true }))
    const mod = await import(pathToFileURL(file).href)

    const written: string[] = []
    const response = {
      statusCode: 0,
      setHeader() {},
      write(chunk: unknown) {
        written.push(String(chunk))
        return true
      },
      end(chunk?: unknown) {
        if (chunk !== undefined) written.push(String(chunk))
      },
    }

    await mod.renderStreaming('/docs', response, { htmlHead: HEAD, htmlTail: TAIL })
    // The renderer resolves on shell-ready; the tail lands when the stream ends.
    await new Promise((r) => setTimeout(r, 0))

    // Asserted as an ORDER, not as a set: a document whose hydration script
    // follows the client entry is a document that re-fetches everything the
    // server already sent.
    expect(written[0]).toContain('<head>')
    const document = written.join('')
    expect(document.indexOf('<head>')).toBeLessThan(document.indexOf('<span>app</span>'))
    expect(document.indexOf('<span>app</span>')).toBeLessThan(
      document.indexOf('__staticRouterHydrationData'),
    )
    expect(document.indexOf('__staticRouterHydrationData')).toBeLessThan(
      document.indexOf('entry-client'),
    )
  })
})
