/**
 * Multi-header CSRF validation (Sec-Fetch-Site primary, Origin fallback,
 * Referer fallback) with wildcard origin allowlist.
 *
 * Per plan g3-server-actions-and-useaction v1.2 § Phase 2 / T2.1 + ADR D3.
 * TanStack `createCsrfMiddleware.ts:120-150` decision-tree pattern combined
 * with Next.js wildcard support. **No DEV bypass** (vs SvelteKit anti-pattern).
 *
 * Web Standards only. The `IncomingMessage` twin was removed once the Web
 * `Request` shape covered every target the framework serves: Node has had a
 * global `Request` since 18, `node-web-adapter.ts` converts an
 * `IncomingMessage` into one, and the Node executor's own gate
 * (`enforceCsrf` → `validateCsrf`) is what actually runs there. Publishing a
 * second, weaker origin policy against the same Node request object invited
 * a consumer to pick the one that demands no custom header.
 *
 * Returns a structured decision: `allow` (boolean) + `reason` (string) +
 * `signal` (which header proved the decision). Caller maps to 403 response
 * + structured log via `limitUntrustedHeaderValueForLogs`.
 */
import { limitUntrustedHeaderValueForLogs } from '../_internal/log-safe.js'

import { isCsrfOriginAllowed } from './wildcard-origin.js'

export interface CsrfMultiHeaderOptions {
  /**
   * Wildcard-aware allowlist of additional origins (beyond same-origin).
   * Example: `['app.example.com', '*.staging.example.com']`.
   */
  allowedOrigins?: readonly string[]
  /**
   * Whether to trust `x-forwarded-host`/`x-forwarded-proto` headers when
   * deriving the request's own origin. Default `false` (EC-5). Set to
   * `true` only when running behind a reverse proxy that strips untrusted
   * forwarded headers from inbound requests.
   */
  trustForwardedHeaders?: boolean
  /**
   * Allow requests when none of Sec-Fetch-Site / Origin / Referer are
   * present (e.g., handcrafted curl). Default `false`. Strict mode rejects
   * such requests because cookies/sessions can still be sent.
   */
  allowRequestsWithoutOriginCheck?: boolean
}

export type CsrfDecision =
  | { allow: true; signal: 'sec-fetch-site' | 'origin' | 'referer' | 'no-headers-allowed' }
  | {
      allow: false
      signal: 'sec-fetch-site' | 'origin' | 'referer' | 'no-headers'
      reason: string
    }

/**
 * T5a.2 Phase B slice 2/6 — pure header-only multi-header CSRF logic.
 * Accepts a structural reader (string|undefined-typed getter per header)
 * + a pre-resolved ownOrigin string.
 *
 * EC-10 (multi-Origin) is not observable here: the Web `Headers` API
 * collapses a repeated header into one comma-joined string, which fails to
 * parse as a URL and is rejected by the Origin branch below. The Node gate
 * carries its own explicit check (`validateCsrf`), where the array shape a
 * synthesized `IncomingMessage` can hold used to be resolved silently.
 */
interface CsrfMultiHeaderInputs {
  secFetchSite: string | undefined
  origin: string | undefined
  referer: string | undefined
}

function evaluateCsrfMultiHeaderFromInputs(
  inputs: CsrfMultiHeaderInputs,
  ownOrigin: string | undefined,
  options: CsrfMultiHeaderOptions,
): CsrfDecision {
  // 1. Sec-Fetch-Site
  //
  // Only `same-origin` and `none` prove the request came from us. `same-site`
  // is deliberately NOT accepted: it covers every host under the same
  // registrable domain, so any sibling subdomain -- compromised, or belonging
  // to another tenant -- can forge a plain form POST carrying it. This gate
  // requires no custom header, so treating `same-site` as proof would extend
  // trust to the whole eTLD+1.
  if (inputs.secFetchSite !== undefined) {
    if (inputs.secFetchSite === 'same-origin' || inputs.secFetchSite === 'none') {
      return { allow: true, signal: 'sec-fetch-site' }
    }
    return {
      allow: false,
      signal: 'sec-fetch-site',
      reason: `Sec-Fetch-Site header indicates ${limitUntrustedHeaderValueForLogs(inputs.secFetchSite)}`,
    }
  }

  // 2. Origin
  if (inputs.origin !== undefined) {
    // `null` is the opaque origin: a `<iframe sandbox="allow-scripts
    // allow-forms">` sends exactly this. It is a valid header value per RFC
    // 6454 and no evidence at all about who sent the request, so it cannot
    // stand in for a same-origin proof.
    if (inputs.origin === 'null') {
      return { allow: false, signal: 'origin', reason: 'Origin is null (opaque origin)' }
    }
    if (originMatches(inputs.origin, ownOrigin, options.allowedOrigins)) {
      return { allow: true, signal: 'origin' }
    }
    return { allow: false, signal: 'origin', reason: 'Origin not in allowlist' }
  }

  // 3. Referer
  if (inputs.referer !== undefined) {
    const refererOrigin = safeOriginFromUrl(inputs.referer)
    if (refererOrigin === undefined) {
      return { allow: false, signal: 'referer', reason: 'Referer not a valid URL' }
    }
    if (originMatches(refererOrigin, ownOrigin, options.allowedOrigins)) {
      return { allow: true, signal: 'referer' }
    }
    return { allow: false, signal: 'referer', reason: 'Referer origin not in allowlist' }
  }

  // 4. No headers
  if (options.allowRequestsWithoutOriginCheck === true) {
    return { allow: true, signal: 'no-headers-allowed' }
  }
  return {
    allow: false,
    signal: 'no-headers',
    reason: 'No Sec-Fetch-Site / Origin / Referer header provided',
  }
}

/**
 * T5a.2 Phase B slice 2/6 — Web-Standards multi-header CSRF evaluator.
 * Consumes `request.headers.get(name)` (native Headers API).
 *
 * **EC-10 note:** the Web `Headers` API collapses multi-value headers into a
 * single comma-separated string at parse time, and that string fails to parse
 * as a URL — so a repeated Origin is rejected by the Origin branch rather than
 * by a signal of its own. (`headers.getSetCookie()` — `Set-Cookie` is the only
 * multi-value header the Web spec exposes; all others are single-valued at the
 * API layer.)
 *
 * Available to `executeWebRequest` consumers who want an origin-based policy
 * alongside the custom-header `validateCsrfRequest`.
 */
export function evaluateCsrfMultiHeaderRequest(
  request: Request,
  options: CsrfMultiHeaderOptions = {},
): CsrfDecision {
  const ownOrigin = getOwnOriginFromRequest(request, options.trustForwardedHeaders === true)
  return evaluateCsrfMultiHeaderFromInputs(
    {
      secFetchSite: request.headers.get('sec-fetch-site') ?? undefined,
      origin: request.headers.get('origin') ?? undefined,
      referer: request.headers.get('referer') ?? undefined,
    },
    ownOrigin,
    options,
  )
}

/**
 * Resolve the request's own origin. Uses the native Headers API + the
 * request's URL (which a Web `Request` always populates with the full
 * absolute URL — unlike `IncomingMessage`, where `req.url` is path-only).
 *
 * Precedence:
 *   1. x-forwarded-host (when trustForwarded=true) → x-forwarded-proto
 *   2. host header → 'http' default proto
 *   3. fallback: request.url's origin (already absolute on Web Request)
 */
function getOwnOriginFromRequest(request: Request, trustForwarded: boolean): string | undefined {
  if (trustForwarded) {
    const fwdHost = request.headers.get('x-forwarded-host')
    if (fwdHost !== null && fwdHost.length > 0) {
      const fwdProto = request.headers.get('x-forwarded-proto') ?? 'http'
      return `${fwdProto}://${fwdHost}`
    }
  }
  const host = request.headers.get('host')
  if (host !== null && host.length > 0) {
    return `http://${host}`
  }
  // Fallback: Web Request guarantees an absolute URL, so we can derive.
  try {
    return new URL(request.url).origin
  } catch {
    return undefined
  }
}

function originMatches(
  candidateOrigin: string,
  ownOrigin: string | undefined,
  allowedOrigins: readonly string[] | undefined,
): boolean {
  // Same-origin (compared by full origin string, normalized)
  if (candidateOrigin.toLowerCase() === ownOrigin?.toLowerCase()) {
    return true
  }
  // Allowlist (wildcards) — compare by host only (origin minus scheme)
  const host = safeHostFromUrl(candidateOrigin)
  if (host === undefined) return false
  if (allowedOrigins === undefined || allowedOrigins.length === 0) return false
  return isCsrfOriginAllowed(host, allowedOrigins)
}

function safeOriginFromUrl(url: string): string | undefined {
  try {
    return new URL(url).origin
  } catch {
    return undefined
  }
}

function safeHostFromUrl(originLike: string): string | undefined {
  try {
    return new URL(originLike).host
  } catch {
    return undefined
  }
}
