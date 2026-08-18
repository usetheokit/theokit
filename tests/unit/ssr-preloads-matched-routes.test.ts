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
