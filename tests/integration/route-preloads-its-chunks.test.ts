/**
 * B-035 T1.2 — the synchronous SSR document carries a `<link rel="modulepreload">` for each chunk
 * the current route needs beyond the entry, and carries none for a route whose code the entry
 * already holds.
 *
 * These assert on the document `buildSsrHtml` assembles, not on a helper composed the same way a
 * test imagines the handler does. A test that re-assembles head and body itself would pass even if
 * the handler never called the injector, which is the wiring gap the acceptance criteria exist to
 * close.
 */
import { describe, expect, it } from 'vitest'

import { buildSsrHtml } from '../../packages/theo/src/cli/commands/start/request-handler.js'

const HEAD = '<!doctype html><html><head><title>App</title></head><body><div id="root">'
const TAIL = '</div></body></html>'

const ctx = (assetsMap: Record<string, string[]>) =>
  ({
    htmlHead: HEAD,
    htmlTail: TAIL,
    assetsMap,
  }) as unknown as Parameters<typeof buildSsrHtml>[0]

/** Everything before `</head>`, and everything after it — AC-002's own split. */
function halves(document: string): { head: string; body: string } {
  const at = document.indexOf('</head>')
  expect(at).toBeGreaterThan(-1)
  return { head: document.slice(0, at), body: document.slice(at) }
}

describe('a route preloads its own chunks', () => {
  it('a lazy route carries modulepreload in the head', () => {
    const doc = buildSsrHtml(
      ctx({ '/about': ['assets/page-about.js', 'assets/shared.js'] }),
      '<h1>About</h1>',
      'nonce-1',
      '/about',
    )
    const { head, body } = halves(doc)

    expect(head).toContain('<link rel="modulepreload" href="/assets/page-about.js">')
    expect(head).toContain('<link rel="modulepreload" href="/assets/shared.js">')
    // The tag belongs in the head or the browser learns about the chunk at the same moment it
    // would have anyway — which is the defect this item exists to fix, not a cosmetic preference.
    expect(body).not.toContain('rel="modulepreload"')
  })

  it('an entry only route emits no modulepreload', () => {
    const doc = buildSsrHtml(ctx({ '/': [] }), '<h1>Home</h1>', 'nonce-1', '/')
    expect(doc).not.toContain('modulepreload')
  })

  it('a route absent from the map emits no modulepreload', () => {
    // An unmapped route is not an error: a build that predates the map, or a route the scan did
    // not see, must serve without preloads rather than fail the request.
    const doc = buildSsrHtml(
      ctx({ '/about': ['assets/a.js'] }),
      '<h1>?</h1>',
      'nonce-1',
      '/missing',
    )
    expect(doc).not.toContain('modulepreload')
  })

  it('ignores a query string and a trailing slash when looking the route up', () => {
    const withQuery = buildSsrHtml(
      ctx({ '/about': ['assets/a.js'] }),
      '<h1>About</h1>',
      'n',
      '/about?ref=x',
    )
    expect(withQuery).toContain('rel="modulepreload"')
  })

  it('escapes a chunk name so a crafted file name cannot close the attribute', () => {
    const doc = buildSsrHtml(ctx({ '/x': ['assets/a".js'] }), '<h1>X</h1>', 'n', '/x')
    expect(doc).not.toContain('href="/assets/a".js"')
    expect(doc).toContain('&quot;')
  })
})
