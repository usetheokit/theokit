import type { RouteNode } from './types.js'

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/')
}

function safeVarName(segment: string, prefix: string): string {
  const safe = segment.replace(/[^a-zA-Z0-9]/g, '_') || 'root'
  return `${prefix}_${safe}`
}

/**
 * Map a route node to its react-router path segment. Dynamic `[slug]` →
 * `:slug`; catch-all `[...slug]` → `*` (react-router splat — param read via
 * `params['*']`); static segments pass through unchanged. (T2.2 — the page
 * router uses react-router's own matcher, NOT the server regex; see plan D3.)
 */
function segmentPath(node: RouteNode): string {
  if (node.dynamic?.catchAll) return '*'
  if (node.dynamic) return `:${node.dynamic.paramName}`
  return node.segment
}

interface ImportEntry {
  varName: string
  importPath: string
}

/**
 * Build the absolute route path for a node by accumulating segments from
 * the root. Used to key the preload map exactly as react-router's
 * `matchRoutes` reports `match.route.path`.
 */
function buildRoutePath(parents: string[], segment: string): string {
  const joined = [...parents, segment].filter(Boolean).join('/')
  return '/' + joined
}

interface WalkAccumulator {
  staticImports: ImportEntry[]
  lazyPages: { varName: string; importPath: string; routePath: string }[]
  layoutState: { found: boolean }
}

function pushIf(staticImports: ImportEntry[], filePath: string | undefined, varName: string): void {
  if (filePath !== undefined) {
    staticImports.push({ varName, importPath: normalizePath(filePath) })
  }
}

function walkRouteTree(node: RouteNode, parents: string[], acc: WalkAccumulator): void {
  const seg = node.segment || 'root'
  const routePath = buildRoutePath(parents, segmentPath(node))

  if (node.page !== undefined) {
    acc.lazyPages.push({
      varName: safeVarName(seg, 'Page'),
      importPath: normalizePath(node.page),
      routePath,
    })
  }
  if (node.layout !== undefined) acc.layoutState.found = true
  pushIf(acc.staticImports, node.layout, safeVarName(seg, 'Layout'))
  pushIf(acc.staticImports, node.error, safeVarName(seg, 'Error'))
  pushIf(acc.staticImports, node.loading, safeVarName(seg, 'Loading'))
  pushIf(acc.staticImports, node.notFound, safeVarName(seg, 'NotFound'))
  for (const child of node.children) {
    const childSegPath = segmentPath(node)
    const nextParents = childSegPath ? [...parents, childSegPath] : parents
    walkRouteTree(child, nextParents, acc)
  }
}

export interface RouteManifestOptions {
  /**
   * Emit pages as `React.lazy` (default) or as static imports.
   *
   * Lazy is right for the browser: it downloads one page's JavaScript instead of all of them. It is
   * wrong for the server, which has every chunk on local disk and gains nothing — while paying for
   * a two-phase render, because `React.lazy` suspends on first render regardless of caching (the
   * `import()` settles a microtask after the render). The shell flushes with the layout alone and
   * the page arrives afterwards inside a hidden div, so the reader watches the document assemble
   * itself. Measured on a production site: CLS 1.12 against a 0.1 budget, `<footer>` served ahead
   * of `<article>`. (usetheokit/theokit#323)
   */
  lazyPages?: boolean
}

export function generateRouteManifest(tree: RouteNode, options: RouteManifestOptions = {}): string {
  const lazyPages_ = options.lazyPages !== false
  // Static imports (always-needed at boot): layouts, errors, loading, not-found.
  // Lazy-loaded pages — tracked separately so we emit React.lazy() and
  // build the preload map.
  const acc: WalkAccumulator = {
    staticImports: [],
    lazyPages: [],
    layoutState: { found: false },
  }
  walkRouteTree(tree, [], acc)
  const staticImports = acc.staticImports
  const lazyPages = acc.lazyPages
  const layoutState = acc.layoutState

  // Phase 4 — Code-splitting + matchRoutes safeguard (EC-3).
  // PAGES are lazy. LAYOUTS / ERROR / LOADING / NOT-FOUND stay static
  // because they're always needed at boot regardless of route.
  // The preload map exposes the same `import()` calls keyed by absolute
  // route path. The entry-client re-matches `routes` against
  // `location.pathname` and awaits the matched entries BEFORE
  // `hydrateRoot`, so React.lazy modules resolve from cache and no
  // Suspense fallback fires during hydration.
  const lines: string[] = [`import React, { Suspense } from 'react'`]

  if (layoutState.found) {
    lines.push(`import { Outlet } from 'react-router'`)
  }

  lines.push('')

  // Static imports first
  for (const imp of staticImports) {
    lines.push(`import ${imp.varName} from '${imp.importPath}'`)
  }

  // Pages: lazy for the browser, static for the server. See RouteManifestOptions.
  for (const lp of lazyPages) {
    lines.push(
      lazyPages_
        ? `const ${lp.varName} = React.lazy(() => import('${lp.importPath}'))`
        : `import ${lp.varName} from '${lp.importPath}'`,
    )
  }

  lines.push('')

  // Preload map — keys are absolute route paths, values are factories that
  // return the same import() the lazy() above resolves. Browsers cache the
  // module by URL so the preload + lazy() share a single promise.
  const preloadEntries = lazyPages.map(
    (lp) => `  '${lp.routePath}': () => import('${lp.importPath}'),`,
  )
  // No TS type annotation — this manifest is emitted as a virtual JS module
  // and Rollup rejects type annotations in production builds.
  const preloadMapLines = ['export const __theoPreloadMap = {', ...preloadEntries, '}', '']

  // Turn react-router matches into the ABSOLUTE paths this map is keyed by.
  //
  // `matchRoutes` reports each route's own `path`, which is RELATIVE to its parent: a nested
  // `/docs/*` route reports `'*'`. Looking those up directly finds nothing, so no module is ever
  // preloaded and the lookup fails silently — which is exactly what happened on both entries until
  // usetheokit/theokit#323. Rebuilding the absolute path by accumulating segments is what makes the
  // keys line up.
  lines.push(
    ...preloadMapLines,
    'export function __theoPreloadPathsFor(matches) {',
    '  const out = []',
    "  let base = ''",
    '  for (const m of matches ?? []) {',
    '    const seg = m && m.route && m.route.path',
    "    if (typeof seg !== 'string') continue",
    "    base = seg.startsWith('/') ? seg : base.endsWith('/') ? base + seg : base + '/' + seg",
    '    out.push(base)',
    '  }',
    '  return out.filter((p) => p in __theoPreloadMap)',
    '}',
    '',
  )

  // Build the children-array string for one node, separately from the
  // wrapping logic — keeps `genRouteConfig` under the complexity ceiling.
  function buildChildrenArray(node: RouteNode, seg: string): string {
    const childConfigs: string[] = []

    // Index route for this node's page — wrap in Suspense (the lazy module
    // is preloaded on initial hydrate, so this fallback never fires there;
    // it covers client-side navigation to other routes too).
    if (node.page) {
      const pageVar = safeVarName(seg, 'Page')
      const fallbackEl = node.loading
        ? `React.createElement(${safeVarName(seg, 'Loading')})`
        : 'null'
      const pageElement = `React.createElement(Suspense, { fallback: ${fallbackEl} }, React.createElement(${pageVar}))`
      childConfigs.push(`{ index: true, element: ${pageElement} }`)
    }

    // Child routes
    for (const child of node.children) {
      childConfigs.push(genRouteConfig(child, false))
    }

    // Not-found wildcard (only at this level)
    if (node.notFound) {
      const nfVar = safeVarName(seg, 'NotFound')
      childConfigs.push(`{ path: '*', element: React.createElement(${nfVar}) }`)
    }

    let arr = `[${childConfigs.join(', ')}]`
    if (node.error) {
      const errVar = safeVarName(seg, 'Error')
      arr = `[{ errorElement: React.createElement(${errVar}), children: ${arr} }]`
    }
    return arr
  }

  // Generate route config
  function genRouteConfig(node: RouteNode, isRoot: boolean): string {
    const seg = node.segment || 'root'
    const childrenArray = buildChildrenArray(node, seg)

    // Build route object
    if (node.layout) {
      const layoutVar = safeVarName(seg, 'Layout')
      const pathPart = isRoot ? `path: '/'` : `path: '${segmentPath(node)}'`
      // Layout receives `<Outlet />` as `children` prop. This supports BOTH
      // conventions: Next.js-style layouts that render `{children}` AND
      // layouts that call `<Outlet />` directly (the prop is the same element,
      // ignored by the latter). Without this, Next.js-style templates render
      // empty because react-router does not pass a `children` prop by default.
      return `{ ${pathPart}, element: React.createElement(${layoutVar}, { children: React.createElement(Outlet) }), children: ${childrenArray} }`
    }

    // No layout — if root, wrap in path '/'
    if (isRoot) {
      if (node.children.length === 0 && !node.page && !node.notFound && !node.error) {
        return `{ path: '/', children: [] }`
      }
      // Root without layout: children are direct routes
      return `{ path: '/', children: ${childrenArray} }`
    }

    // Child segment without layout — just a route
    if (node.page && node.children.length === 0 && !node.error && !node.notFound) {
      const pageVar = safeVarName(seg, 'Page')
      const fallbackEl = node.loading
        ? `React.createElement(${safeVarName(seg, 'Loading')})`
        : 'null'
      const pageElement = `React.createElement(Suspense, { fallback: ${fallbackEl} }, React.createElement(${pageVar}))`
      return `{ path: '${segmentPath(node)}', element: ${pageElement} }`
    }

    // Child with children but no layout
    return `{ path: '${segmentPath(node)}', children: ${childrenArray} }`
  }

  const routeConfig = genRouteConfig(tree, true)
  lines.push(`export const routes = [${routeConfig}]`)

  return lines.join('\n')
}
