import { describe, it, expect } from 'vitest'

// `generateEntryServer` is internal to the build, so it comes from source; the manifest generator
// is part of the public surface and comes from the package, which also proves the two agree.
import { generateRouteManifest } from 'theokit'
import type { RouteNode } from 'theokit'

import { generateEntryServer } from '../../packages/theo/src/router/entry-server.js'

/**
 * Pages are `React.lazy()` in the route manifest. That is right for the browser and pure loss on the
 * server, which already has every chunk on local disk: rendering without resolving them first makes
 * React suspend on the page component, so `onShellReady` fires with the layout alone and the actual
 * page streams afterwards inside a hidden div.
 *
 * The reader sees an empty frame that fills in. Measured on a production documentation site before
 * this fix: CLS 1.12 against a 0.1 budget, `<article>` absent from the DOM for ~700ms, and the
 * served HTML placing `<footer>` at byte 16800 ahead of `<article>` at 22351.
 *
 * `entry.ts` has always done this before `hydrateRoot`. These tests pin the server half.
 *
 * Regression tests for usetheokit/theokit#323.
 */
const serverEntry = generateEntryServer({ ssr: true })

describe('server entry preloads the matched routes', () => {
  it('imports the matcher and the preload map', () => {
    expect(serverEntry).toContain('matchRoutes')
    expect(serverEntry).toContain('__theoPreloadMap')
  })

  it('awaits the preload BEFORE creating the handler', () => {
    // Order is the whole point: preloading after the render has started changes nothing.
    const preload = serverEntry.indexOf('__theoPreloadMap[p]()')
    // The CALL, not the import at the top of the file.
    const render = serverEntry.indexOf('renderToPipeableStream(app')

    expect(preload).toBeGreaterThan(-1)
    expect(preload).toBeLessThan(render)
    expect(serverEntry).toContain('await Promise.all(')
  })

  it('matches on the path alone, ignoring the query string', () => {
    // `matchRoutes` takes a pathname; handing it `/docs/x?y=1` matches nothing, and nothing being
    // preloaded is exactly the bug, silently.
    expect(serverEntry).toContain("url.split('?')[0]")
  })

  it('does not let a failed import break the render', () => {
    // React.lazy retries and suspends as before — no worse than not preloading.
    expect(serverEntry).toContain('.catch(() => null)')
  })
})

/**
 * Runs the manifest's OWN emitted helper — the map and the function are pulled out of the generated
 * source and evaluated, so this tests the code that actually ships rather than a restatement of it.
 */
function loadPreloadHelper(manifest: string) {
  const map = /export const __theoPreloadMap = \{[\s\S]*?\n\}/.exec(manifest)?.[0]
  const fn = /export function __theoPreloadPathsFor[\s\S]*?\n\}/.exec(manifest)?.[0]
  if (!map || !fn) throw new Error('manifest no longer emits the preload map or its helper')

  const source = `${map.replace('export ', '')}\n${fn.replace('export ', '')}\nreturn { __theoPreloadMap, __theoPreloadPathsFor }`
  // The input is this repository's own generated manifest, and running it is the point: a test that
  // reimplemented the helper would pass while the emitted one stayed broken — which is exactly the
  // bug being fixed here.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, sonarjs/code-eval
  return Function(source)() as {
    __theoPreloadMap: Record<string, unknown>
    __theoPreloadPathsFor: (m: unknown[]) => string[]
  }
}

describe('__theoPreloadPathsFor turns relative matches into map keys', () => {
  const nested = generateRouteManifest({
    segment: '',
    path: '/',
    page: '/app/page.tsx',
    children: [{ segment: 'docs', path: 'docs', children: [], page: '/app/docs/page.tsx' }],
  } as RouteNode)

  it('keys the map by ABSOLUTE path', () => {
    const { __theoPreloadMap } = loadPreloadHelper(nested)

    expect(Object.keys(__theoPreloadMap)).toContain('/docs')
  })

  it('resolves a nested match whose own path is relative', () => {
    // This is the defect: react-router reports `'docs'` for that route, the map is keyed `'/docs'`,
    // and a direct lookup finds nothing — so nothing was ever preloaded, silently, on both entries.
    const { __theoPreloadPathsFor } = loadPreloadHelper(nested)

    expect(
      __theoPreloadPathsFor([{ route: { path: '/' } }, { route: { path: 'docs' } }]),
    ).toContain('/docs')
  })

  it('drops matches that name no path', () => {
    const { __theoPreloadPathsFor } = loadPreloadHelper(nested)

    expect(__theoPreloadPathsFor([{ route: {} }, { route: { path: 'nope' } }])).toEqual([])
  })

  it('returns nothing for no matches rather than throwing', () => {
    const { __theoPreloadPathsFor } = loadPreloadHelper(nested)

    expect(__theoPreloadPathsFor([])).toEqual([])
  })
})

describe('the manifest still exposes what the server needs', () => {
  const manifest = generateRouteManifest({
    segment: '',
    path: '/',
    children: [],
    page: '/app/page.tsx',
  } as RouteNode)

  it('exports the preload map the server entry imports', () => {
    // These two files are generated independently; a rename on one side would leave the other
    // importing a binding that does not exist, and the failure would only appear at runtime.
    expect(manifest).toContain('export const __theoPreloadMap')
  })

  it('keeps pages lazy, since the browser still benefits', () => {
    expect(manifest).toContain('React.lazy')
  })
})

describe('the manifest emits pages differently per build', () => {
  const tree = {
    segment: '',
    path: '/',
    page: '/app/page.tsx',
    children: [{ segment: 'docs', path: 'docs', children: [], page: '/app/docs/page.tsx' }],
  } as RouteNode

  it('keeps pages lazy for the browser, where code-splitting pays', () => {
    expect(generateRouteManifest(tree)).toContain('React.lazy')
  })

  it('imports pages statically for the server, where it only costs', () => {
    // A lazy page suspends on first render regardless of caching — the import settles a microtask
    // after the render — so the shell flushes with the layout alone and the page arrives afterwards
    // inside a hidden div. The server has every chunk on local disk and gains nothing in return.
    const server = generateRouteManifest(tree, { lazyPages: false })

    expect(server).not.toContain('React.lazy')
    expect(server).toContain("import Page_docs from '/app/docs/page.tsx'")
  })

  it('still exports the preload map on the server build', () => {
    // The generated server entry imports these bindings unconditionally; dropping them would turn
    // a rendering improvement into an import error.
    const server = generateRouteManifest(tree, { lazyPages: false })

    expect(server).toContain('export const __theoPreloadMap')
    expect(server).toContain('export function __theoPreloadPathsFor')
  })
})
