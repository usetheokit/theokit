import { describe, expect, it } from 'vitest'
import { join } from 'node:path'

import { scanRoutes } from '../../packages/theo/src/router/scan.js'
import { generateRouteManifest } from '../../packages/theo/src/router/generate.js'

/**
 * T2.3 — integration coverage for dynamic page routing: exercises the REAL
 * scan → generate pipeline on a committed fixture app and asserts the emitted
 * react-router config wires the dynamic + catch-all routes.
 *
 * NOTE: the browser-level Playwright e2e (navigate to /blog/hello, assert the
 * rendered slug) is DEFERRED — playwright.config.ts + the served fixture app
 * are not present on the `develop` branch (they live in a worktree/CI setup).
 * This integration test covers the same wiring at the route-manifest boundary,
 * which is where the dynamic-segment logic actually lives.
 */
const FIXTURE_APP = join(import.meta.dirname, '..', 'fixtures', 'dynamic-routes', 'app')

describe('dynamic page routing — scan → generate pipeline (T2.3)', () => {
  it('test_dynamic_route_pipeline_emits_colon_param_for_blog_slug', () => {
    const manifest = generateRouteManifest(scanRoutes(FIXTURE_APP))
    // react-router single dynamic segment
    expect(manifest).toContain(":slug'")
    // the lazy page module for the dynamic route is wired
    expect(manifest).toContain('blog/[slug]/page.tsx')
    expect(manifest).toMatch(/React\.lazy\(\(\) => import\(/)
  })

  it('test_dynamic_route_pipeline_emits_splat_for_docs_catchall', () => {
    const manifest = generateRouteManifest(scanRoutes(FIXTURE_APP))
    expect(manifest).toContain("path: '*'")
    expect(manifest).toContain('docs/[...path]/page.tsx')
    // the raw bracket folder name must NOT leak into a route path
    expect(manifest).not.toContain("'[...path]'")
    expect(manifest).not.toContain("'[slug]'")
  })

  it('test_dynamic_route_preload_map_keyed_by_react_router_pattern', () => {
    const manifest = generateRouteManifest(scanRoutes(FIXTURE_APP))
    // preload map key uses the react-router pattern (:slug), matching what
    // matchRoutes reports as match.route.path at runtime.
    expect(manifest).toMatch(/'\/blog\/:slug':\s*\(\) => import\(/)
  })
})
