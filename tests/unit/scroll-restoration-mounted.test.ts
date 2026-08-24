import { describe, it, expect } from 'vitest'
import { generateRouteManifest } from '../../packages/theo/src/router/generate.js'
import type { RouteNode } from '../../packages/theo/src/router/types.js'

/**
 * B-029 — a back navigation landed wherever the browser left the scroll offset,
 * because `ScrollRestoration` was mounted nowhere. It appeared in no file under
 * `packages/`.
 *
 * Mounting it inside the route tree looked dangerous at first and measurement
 * says it is not. `router/entry-server.ts` goes to some length to keep the
 * server tree byte-identical to the client one — it passes `hydrate: false` to
 * `StaticRouterProvider` precisely so react-router does NOT emit a `<script>`
 * that the client tree lacks, a mismatch that measured CLS 0.39. A component
 * that renders a script on the server and nothing on the client would reproduce
 * that defect.
 *
 * `ScrollRestoration` is not that component here. Its first statement after the
 * hooks is `if (!remixContext || remixContext.isSpaMode) return null`, and
 * `remixContext` is react-router's Framework Mode context, which a
 * `createBrowserRouter` application does not have. So it renders `null` on both
 * sides — no script, no mismatch, and no CSP nonce to thread. The restoration
 * itself lives in `useScrollRestoration`, called before that return, and needs
 * only the data-router context `RouterProvider` already supplies.
 */

function tree(over: Partial<RouteNode> = {}): RouteNode {
  return {
    segment: '',
    path: '',
    children: [],
    page: '/app/page.tsx',
    layout: undefined,
    error: undefined,
    loading: undefined,
    notFound: undefined,
    ...over,
  } as RouteNode
}

describe('the generated manifest mounts scroll restoration (B-029)', () => {
  it('test_scroll_restoration_is_imported_from_react_router', () => {
    // An element referencing an unimported name is a ReferenceError at boot,
    // which is the failure mode #344 shipped on a different line.
    expect(generateRouteManifest(tree())).toMatch(/import\s*\{[^}]*\bScrollRestoration\b[^}]*\}/)
  })

  it('test_scroll_restoration_is_mounted_when_the_root_has_no_layout', () => {
    expect(generateRouteManifest(tree())).toContain('React.createElement(ScrollRestoration)')
  })

  it('test_scroll_restoration_is_mounted_when_the_root_has_a_layout', () => {
    // The layout path is the one with an element already, so it is the one where
    // mounting could have displaced the application's own root component.
    const out = generateRouteManifest(tree({ layout: '/app/layout.tsx' }))
    expect(out).toContain('React.createElement(ScrollRestoration)')
  })

  it('test_the_layout_still_receives_outlet_as_children', () => {
    // Regression guard over regression-7: mounting must not cost the fix that
    // makes a Next.js-style layout render at all.
    const out = generateRouteManifest(tree({ layout: '/app/layout.tsx' }))
    expect(out).toMatch(
      /createElement\(\s*\w*Layout\w*\s*,\s*\{\s*children:\s*React\.createElement\(Outlet\)\s*\}\s*\)/,
    )
  })
})
