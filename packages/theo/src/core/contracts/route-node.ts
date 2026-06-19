/**
 * core/contracts/route-node.ts
 *
 * Canonical home for `RouteNode` (file-system route tree shape) — consumed
 * by `router/`, `vite-plugin/`, AND `devtools/server-side/`. Moved here in
 * T2.2 of architecture-cleanup so `devtools → core/contracts` is the legal
 * edge (replacing the prior `devtools → router` violation).
 */

/**
 * Dynamic-segment metadata for a file-system route node.
 * Set when the directory name is `[param]` (single segment) or `[...slug]`
 * (catch-all). `generate.ts` turns this into react-router `:param` / `*` syntax.
 */
export interface RouteNodeDynamic {
  /** The param name (`slug` for `[slug]` / `[...slug]`). Always `[A-Za-z0-9_]+`. */
  paramName: string
  /** True for catch-all `[...slug]`, false for single dynamic `[slug]`. */
  catchAll: boolean
}

export interface RouteNode {
  segment: string
  path: string
  page?: string
  layout?: string
  error?: string
  loading?: string
  notFound?: string
  /** Present only for dynamic / catch-all segments (additive — static routes omit it). */
  dynamic?: RouteNodeDynamic
  children: RouteNode[]
}
