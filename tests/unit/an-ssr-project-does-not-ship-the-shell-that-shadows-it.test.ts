/**
 * With `ssr: true`, the Vercel static host must not hold the shell that shadows the SSR route.
 *
 * Measured on the FIRST real Vercel deploy this repository ever made, 2026-09-29 — the defect a
 * deploy exists to find, and one no local probe can reach:
 *
 *     GET /   ->  200, 694 bytes, `<div id="root">` carrying ZERO bytes, no hydration script
 *
 * The same function, driven locally through an http server with the `launcherType: "Nodejs"` shape
 * its own `.vc-config.json` declares, rendered correctly and came back with zero defects. A local
 * probe calls the function directly; it never crosses the routing layer, and the routing layer is
 * where this lives.
 *
 * ## The cause, and why B-317 did not close it
 *
 * `renderVercelConfigJson` already switches the last route on `ssr`:
 *
 *     { handle: 'filesystem' },
 *     { src: '/(.*)', dest: opts.ssr === true ? '/api' : '/index.html' },
 *
 * and its comment states the premise that makes that correct — *"`{ handle: 'filesystem' }` above
 * still serves every real file, so this is reached only by a page request"*.
 *
 * **That premise is false for `/`.** Vercel's filesystem handler satisfies a directory path with the
 * `index.html` inside it, so `/` IS a real file whenever the build copied one into `static/`. B-317
 * fixed where the last route POINTS; this fixes the fact that, for `/`, the route is never reached.
 *
 * ## Why `index.html` specifically
 *
 * That basename is the mechanism: it is what the platform uses to satisfy a directory path, so it is
 * what shadows a page route. A file like `foo.html` is served at the explicit path `/foo.html`, which
 * no page route claims, and removing it would take a document the project meant to publish.
 */
import { describe, expect, it } from 'vitest'

import { shouldCopyIntoStatic } from '../../packages/theo/src/adapters/vercel.js'

const CLIENT = '/p/.theokit/client'

describe('an SSR project does not ship the shell that shadows it', () => {
  it('drops the root index.html when ssr is on', () => {
    expect(
      shouldCopyIntoStatic(`${CLIENT}/index.html`, true),
      "the shell reaches `static/`, so Vercel's filesystem handler answers `/` with it and the SSR " +
        'route below is never reached — measured on a real deploy as 694 bytes with an empty #root',
    ).toBe(false)
  })

  it('keeps everything else when ssr is on', () => {
    // COUNTERPROOF. A filter that dropped more than the shell would take the assets the page needs,
    // and the page would render into a 404 for its own stylesheet.
    for (const f of [
      'assets/app-abc.js',
      'assets/app-abc.css',
      'favicon.svg',
      'robots.txt',
      'logo.png',
    ]) {
      expect(shouldCopyIntoStatic(`${CLIENT}/${f}`, true), `${f} was dropped`).toBe(true)
    }
  })

  it('keeps the shell when ssr is off, because then it IS the document', () => {
    // The other direction, and it must stay true: a client-rendered project is served by the static
    // host, and `renderVercelConfigJson` sends `/(.*)` to `/index.html` for exactly that case.
    expect(shouldCopyIntoStatic(`${CLIENT}/index.html`, false)).toBe(true)
  })

  it('shadowing is about the basename, at any depth', () => {
    // `{ src: '/(.*)', dest: '/api' }` is the fallback for EVERY path, so `about/index.html` shadows
    // `/about` exactly as the root one shadows `/`.
    expect(shouldCopyIntoStatic(`${CLIENT}/about/index.html`, true)).toBe(false)
    expect(shouldCopyIntoStatic(`${CLIENT}/about/index.html`, false)).toBe(true)
  })

  it('does not mistake a name that merely ends the same way', () => {
    // NEGATIVE case: `not-index.html` and `index.html.map` are not what the platform resolves a
    // directory to, and dropping them would remove a file the project published on purpose.
    expect(shouldCopyIntoStatic(`${CLIENT}/not-index.html`, true)).toBe(true)
    expect(shouldCopyIntoStatic(`${CLIENT}/index.html.map`, true)).toBe(true)
  })

  it('never drops a directory, or the copy stops before it descends', () => {
    // `cpSync`'s filter is asked about DIRECTORIES too, and returning false prunes the whole subtree.
    // Dropping `assets/` would take every asset with it — the failure mode that turns one empty page
    // into a site with no styles.
    expect(shouldCopyIntoStatic(`${CLIENT}/assets`, true)).toBe(true)
    expect(shouldCopyIntoStatic(CLIENT, true)).toBe(true)
  })
})
