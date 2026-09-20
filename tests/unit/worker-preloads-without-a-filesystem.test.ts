/**
 * B-035 T1.3 — the Cloudflare worker preloads a route's chunks without a filesystem.
 *
 * A Worker cannot read `.theokit/client/assets-map.json` at request time, so the map is baked into
 * the generated entry as a literal — the same reason and the same mechanism the document shell
 * already uses (`cloudflare.ts` #343).
 *
 * WHAT THIS TEST DOES NOT DO, stated rather than implied: it does not import and run the whole
 * generated worker. That entry imports `/@theo/entry-server`, a Vite virtual module that resolves
 * only inside a build, so executing it whole is not available to a unit test. What runs here is the
 * injector the entry emits, extracted from the generated source and executed in a function scope
 * with no `require`, no `import` and therefore no `node:fs` — which is the property the test is
 * named for. The end-to-end behaviour is covered against the Node server in
 * `tests/integration/route-preloads-its-chunks.test.ts`.
 */
import { describe, expect, it } from 'vitest'

import { renderCloudflareWorkerEntry } from '../../packages/theo/src/adapters/cloudflare.js'
import { injectModulePreloads } from '../../packages/theo/src/core/module-preloads.js'

const MAP = { '/about': ['assets/page-about.js', 'assets/shared.js'], '/': [] }

const entry = (over: Record<string, unknown> = {}): string =>
  renderCloudflareWorkerEntry({
    ssrStreaming: true,
    htmlHead: '<html><head><title>App</title></head><body><div id="root">',
    htmlTail: '</div></body></html>',
    assetsMap: MAP,
    ...over,
  } as Parameters<typeof renderCloudflareWorkerEntry>[0])

/**
 * Pull the emitted injector out of the generated source and make it callable with NO module
 * scope — no `require`, no `import`, so no `node:fs`. If it reached for one it would throw here.
 */
function emittedInjector(source: string): (head: string, map: unknown, url: string) => string {
  // The WHOLE emitted block, not one function out of it: in the worker these live side by side in
  // module scope, and extracting a single function would test a shape the worker never has.
  const at = source.indexOf('const __THEO_ASSETS_MAP')
  expect(at, 'the entry must emit the baked map').toBeGreaterThan(-1)
  const marker = 'function __theoInjectPreloads'
  const injectorAt = source.indexOf(marker, at)
  expect(injectorAt, 'the entry must emit __theoInjectPreloads').toBeGreaterThan(-1)
  let depth = 0
  let end = injectorAt
  for (let i = source.indexOf('{', injectorAt); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    if (source[i] === '}') {
      depth -= 1
      if (depth === 0) {
        end = i + 1
        break
      }
    }
  }
  const block = source.slice(at, end)
  // Executing the emitted source in an empty scope IS the assertion: a worker has no module
  // scope to reach into, so anything this block needs must be inside it. The input is source
  // this repository generated three lines above — not user input, not a network payload.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, sonarjs/code-eval -- see above
  return new Function(`${block}; return __theoInjectPreloads`)() as (
    head: string,
    map: unknown,
    url: string,
  ) => string
}

describe('the worker preloads without a filesystem', () => {
  it('bakes the map into the entry as a literal', () => {
    const source = entry()
    expect(source).toContain('assets/page-about.js')
    // A literal, not a read: no filesystem call may appear for the map.
    expect(source).not.toContain("readFileSync('assets-map")
    expect(source).not.toContain('assets-map.json')
  })

  it('the emitted injector runs with no module scope and preloads the route chunks', () => {
    const inject = emittedInjector(entry())
    const head = inject('<html><head><title>App</title></head>', MAP, '/about')
    expect(head).toContain('<link rel="modulepreload" href="/assets/page-about.js">')
    expect(head).toContain('<link rel="modulepreload" href="/assets/shared.js">')
    expect(head.indexOf('modulepreload')).toBeLessThan(head.indexOf('</head>'))
  })

  it('the emitted injector matches the Node implementation on every case that matters', () => {
    // The worker carries a COPY because it cannot import the original. This is what stops the copy
    // from drifting: change one and this fails.
    const inject = emittedInjector(entry())
    const cases: [string, unknown, string][] = [
      ['<head></head>', MAP, '/about'],
      ['<head></head>', MAP, '/'],
      ['<head></head>', MAP, '/about/'],
      ['<head></head>', MAP, '/about?ref=x'],
      ['<head></head>', MAP, '/missing'],
      ['<head></head>', { '/x': ['a".js'] }, '/x'],
      ['<head></head>', undefined, '/about'],
      ['no closing tag', MAP, '/about'],
      ['<HEAD></HEAD >', MAP, '/about'],
    ]
    for (const [head, map, url] of cases) {
      expect(inject(head, map, url), `case ${url} / ${JSON.stringify(map)}`).toBe(
        injectModulePreloads(head, map as never, url),
      )
    }
  })

  it('emits nothing about preloads when the build produced no map', () => {
    const source = entry({ assetsMap: undefined })
    expect(source).not.toContain('__theoInjectPreloads')
  })
})
