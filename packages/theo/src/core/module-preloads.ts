/**
 * Render `<link rel="modulepreload">` for the chunks a route needs beyond the entry (B-035).
 *
 * This is the single source of truth for the Node path. The Cloudflare worker cannot import it:
 * a Worker has no filesystem, the entry is GENERATED source, and `theokit`'s package exports
 * declare no subpath that would reach here — which B-035's AC-009 forbids adding. So the worker
 * carries an emitted copy, and `tests/unit/worker-preloads-without-a-filesystem.test.ts` feeds both
 * the same inputs and asserts identical output. A copy guarded by an equivalence test is a copy
 * that cannot silently drift; an unguarded one is the duplication DRY is actually about.
 */

/** A route path mapped to the chunk file names it needs beyond the entry. */
export type AssetsMap = Record<string, string[] | undefined>

/** Attribute-safe: a chunk name must not be able to close the attribute it sits in. */
export function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

/**
 * Inject one `<link rel="modulepreload">` per chunk the route needs, before `</head>`.
 *
 * In the HEAD, not the body: a preload the browser meets after parsing the entry teaches it
 * nothing it was not about to learn a moment later, which is the defect rather than a preference.
 *
 * Returns `head` unchanged for an absent map, an unmapped route, or an empty chunk list. None of
 * those is an error: a build predating the map, or a route the scan did not see, must serve
 * without preloads rather than fail the request.
 */
export function injectModulePreloads(
  head: string,
  assetsMap: AssetsMap | undefined,
  url: string,
): string {
  if (assetsMap === undefined) return head
  // The map is keyed by route path; a request carries a query string and may carry a trailing
  // slash, neither of which changes which route is being served.
  const path = url.split(/[?#]/)[0] ?? url
  const route = path.length > 1 ? path.replace(/\/$/, '') : path
  const chunks = assetsMap[route] ?? assetsMap[path]
  if (chunks === undefined || chunks.length === 0) return head
  const links = chunks
    .map((chunk) => `<link rel="modulepreload" href="/${escapeAttribute(chunk)}">`)
    .join('')
  const closing = /<\/head\s*>/i
  return closing.test(head) ? head.replace(closing, (tag) => links + tag) : head + links
}
