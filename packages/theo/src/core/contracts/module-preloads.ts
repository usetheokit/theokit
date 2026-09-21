/**
 * Render `<link rel="modulepreload">` for the chunks a route needs beyond the entry (B-035).
 *
 * **The single source of truth, for the Node server AND the Cloudflare worker.**
 *
 * An earlier revision of this file asserted that the worker had to carry a COPY because
 * `theokit`'s package exports declare no subpath reaching `core/`. **That was false, and it was
 * stated three times** — here, in `adapters/cloudflare.ts`, and in a commit message. `server/
 * index.ts` already re-exports from `core/contracts/` *"for consumer ergonomics"* in its own
 * words, `adapters/security-headers.ts` imports `generateNonce` and `buildSecurityHeaders` from
 * here, and the generated worker imports BOTH of those subpaths. Adding a named export to an
 * existing barrel touches no `package.json`, so the constraint never existed.
 *
 * The copy is gone. `theokit/server` re-exports `injectModulePreloads` and the worker imports it,
 * which is the shape `adapters/security-headers.ts` established one directory over — and whose
 * docblock states the reason better than this one could: *"a shape stated in two files drifts"*.
 * It drifted the same day: the proxy fix below landed in this file and not in the copy.
 */

/** A route path mapped to the chunk file names it needs beyond the entry. */
export type AssetsMap = Record<string, string[] | undefined>

/** Attribute-safe: a chunk name must not be able to close the attribute it sits in. */
function escapeAttribute(value: string): string {
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
/**
 * The route path a request target names, whichever form the target takes.
 *
 * **Found at review, B-035.** The two call sites do not agree on the shape they pass:
 * `cli/commands/start/request-handler.ts` passes `req.url` RAW, and the Cloudflare worker passes
 * `new URL(request.url).pathname`. RFC 9112 §3.2.2 requires an origin server to accept the
 * absolute form, and a proxy sends it — so `GET http://example.com/about` reached this function as
 * a whole URL, matched no key, and the feature silently did nothing on Node behind a proxy while
 * the worker worked. Normalising HERE rather than at each call site is what makes the two agree by
 * construction instead of by two people remembering.
 *
 * Returns `undefined` for a target this cannot read. That is deliberate: inventing a route from an
 * unparseable target would preload another route's chunks, which is worse than preloading none.
 */
function routePathFromTarget(target: string): string | undefined {
  if (target.startsWith('/')) return target.split(/[?#]/)[0]
  // Absolute form. `URL` is the platform's own parser and is present in Node and in a Worker —
  // parsimony rung 3, and it is the same parser the worker's call site already uses.
  try {
    return new URL(target).pathname
  } catch {
    return undefined
  }
}

export function injectModulePreloads(
  head: string,
  assetsMap: AssetsMap | undefined,
  url: string,
): string {
  if (assetsMap === undefined) return head
  const path = routePathFromTarget(url)
  if (path === undefined) return head
  const route = path.length > 1 ? path.replace(/\/$/, '') : path
  const chunks = assetsMap[route] ?? assetsMap[path]
  if (chunks === undefined || chunks.length === 0) return head
  const links = chunks
    .map((chunk) => `<link rel="modulepreload" href="/${escapeAttribute(chunk)}">`)
    .join('')
  const closing = /<\/head\s*>/i
  return closing.test(head) ? head.replace(closing, (tag) => links + tag) : head + links
}

/**
 * Decide whether a document is a usable assets map, and return it if so.
 *
 * **Found at review, B-035.** This body existed TWICE, byte-identical modulo the function name —
 * `cli/commands/start/ssr-setup.ts` for the Node server and `adapters/cloudflare.ts` for the bake.
 * Nothing forced the copy: `.dependency-cruiser.cjs` permits `adapters/` -> `core/`, and
 * `cloudflare.ts` already imports from here. What was duplicated is the ACCEPTANCE RULE for a file
 * format, so tightening one side — rejecting `../` in a chunk name, say, which is the obvious next
 * hardening for a value that becomes an `href` — would have left the other accepting it, surfacing
 * as "Cloudflare accepts a map Node rejects" in a deploy.
 *
 * The I/O stays with each caller; only the shape decision lives here.
 *
 * Returns `undefined` for anything unusable, and never throws. A server that refused to boot, or a
 * deploy that failed, because an optimisation was missing would turn a lost round trip into an
 * outage.
 */
export function parseAssetsMap(text: string): Record<string, string[]> | undefined {
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
    const entries = Object.entries(parsed).filter(
      (entry): entry is [string, string[]] =>
        Array.isArray(entry[1]) && entry[1].every((value) => typeof value === 'string'),
    )
    return entries.length > 0 ? Object.fromEntries(entries) : undefined
  } catch {
    return undefined
  }
}
