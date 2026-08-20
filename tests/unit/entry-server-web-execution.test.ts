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
        'const renderToPipeableStream = () => ({ pipe() {}, abort() {} })',
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
