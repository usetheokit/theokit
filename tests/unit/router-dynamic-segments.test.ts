import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { scanRoutes } from '../../packages/theo/src/router/scan.js'

/**
 * T2.1 — file-system PAGE routing must recognize dynamic segments [param] and
 * catch-all [...slug] (parity with API routes). RouteNode gains optional
 * `dynamic` metadata; generate.ts (T2.2) turns it into react-router :param / *.
 */
let app: string
function mkpage(rel: string) {
  const dir = join(app, rel)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'page.tsx'), 'export default function Page() { return null }')
}
function findNode(node: any, segment: string): any {
  if (node.segment === segment) return node
  for (const c of node.children ?? []) {
    const f = findNode(c, segment)
    if (f) return f
  }
  return undefined
}

beforeEach(() => {
  app = mkdtempSync(join(tmpdir(), 'router-dyn-'))
})
afterEach(() => rmSync(app, { recursive: true, force: true }))

describe('scanRoutes dynamic segments (T2.1)', () => {
  it('test_scan_marks_single_dynamic_segment_with_paramName', () => {
    mkpage('blog/[slug]')
    const node = findNode(scanRoutes(app), '[slug]')
    expect(node?.dynamic).toEqual({ paramName: 'slug', catchAll: false })
  })

  it('test_scan_marks_catchall_segment', () => {
    mkpage('docs/[...path]')
    const node = findNode(scanRoutes(app), '[...path]')
    expect(node?.dynamic).toEqual({ paramName: 'path', catchAll: true })
  })

  it('test_scan_leaves_static_segment_without_dynamic_field', () => {
    mkpage('blog')
    const node = findNode(scanRoutes(app), 'blog')
    expect(node?.dynamic).toBeUndefined()
  })

  it('test_scan_preserves_route_group_behavior', () => {
    mkpage('(marketing)/about')
    const tree = scanRoutes(app)
    // route group contributes no URL segment; 'about' lives under it with empty-segment parent
    const about = findNode(tree, 'about')
    expect(about).toBeDefined()
    expect(about.dynamic).toBeUndefined()
  })

  it('test_scan_distinguishes_catchall_from_dynamic', () => {
    mkpage('x/[...slug]')
    const node = findNode(scanRoutes(app), '[...slug]')
    // must be catch-all, NOT a dynamic param literally named '...slug'
    expect(node?.dynamic).toEqual({ paramName: 'slug', catchAll: true })
  })

  it('test_scan_rejects_optional_catchall', () => {
    mkpage('blog/[[...slug]]')
    expect(() => scanRoutes(app)).toThrow(/optional catch-all|not supported/i)
  })

  it('test_scan_rejects_invalid_param_charset', () => {
    mkpage('blog/[user-id]')
    expect(() => scanRoutes(app)).toThrow(/invalid route param|A-Za-z0-9_/i)
  })
})

import { generateRouteManifest } from '../../packages/theo/src/router/generate.js'
import type { RouteNode } from '../../packages/theo/src/core/contracts/route-node.js'

function leaf(segment: string, page: string, dynamic?: RouteNode['dynamic']): RouteNode {
  return { segment, path: '/' + segment, page, children: [], ...(dynamic ? { dynamic } : {}) }
}

describe('generateRouteManifest dynamic emission (T2.2)', () => {
  it('test_generate_emits_colon_param_for_dynamic', () => {
    const tree: RouteNode = {
      segment: '',
      path: '/',
      children: [
        leaf('[slug]', '/app/blog/[slug]/page.tsx', { paramName: 'slug', catchAll: false }),
      ],
    }
    const out = generateRouteManifest(tree)
    expect(out).toContain(":slug'")
    expect(out).not.toContain("'[slug]'")
  })

  it('test_generate_emits_splat_for_catchall', () => {
    const tree: RouteNode = {
      segment: '',
      path: '/',
      children: [
        leaf('[...path]', '/app/docs/[...path]/page.tsx', { paramName: 'path', catchAll: true }),
      ],
    }
    const out = generateRouteManifest(tree)
    expect(out).toContain("path: '*'")
    expect(out).not.toContain("'[...path]'")
  })

  it('test_generate_static_output_unchanged (golden guard, EC-13)', () => {
    const staticTree: RouteNode = {
      segment: '',
      path: '/',
      children: [
        leaf('blog', '/app/blog/page.tsx'),
        {
          segment: 'about',
          path: '/about',
          page: '/app/about/page.tsx',
          layout: '/app/about/layout.tsx',
          children: [],
        },
      ],
    }
    expect(generateRouteManifest(staticTree)).toMatchSnapshot()
  })
})

describe('generate catch-all is terminal (EC-9)', () => {
  it('test_generate_catchall_is_terminal', () => {
    // A catch-all leaf emits react-router splat '*' (terminal match), never a
    // nested literal segment. react-router requires the splat to be the last
    // segment in its branch; a catch-all page is a leaf by construction.
    const tree: RouteNode = {
      segment: '',
      path: '/',
      children: [
        leaf('[...path]', '/app/docs/[...path]/page.tsx', { paramName: 'path', catchAll: true }),
      ],
    }
    const out = generateRouteManifest(tree)
    expect(out).toContain("path: '*'")
    // no nested child path emitted after the splat (terminal)
    expect(out).not.toMatch(/path: '\*'[^}]*children: \[\{[^]]*path:/)
  })
})
