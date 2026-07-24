/**
 * Multi-header CSRF validation (Sec-Fetch-Site primary, Origin fallback,
 * Referer fallback) with wildcard origin allowlist.
 *
 * Per plan g3-server-actions-and-useaction v1.2 § Phase 2 / T2.1 + ADR D3.
 * TanStack `createCsrfMiddleware.ts:120-150` decision-tree pattern combined
 * with Next.js wildcard support. **No DEV bypass** (vs SvelteKit anti-pattern).
 *
 * Returns a structured decision: `allow` (boolean) + `reason` (string) +
 * `signal` (which header proved the decision). Caller maps to 403 response
 * + structured log via `limitUntrustedHeaderValueForLogs`.
 */
import type { IncomingMessage } from 'node:http'

import { limitUntrustedHeaderValueForLogs } from '../_internal/log-safe.js'

import { isCsrfOriginAllowed } from './wildcard-origin.js'

interface CsrfMultiHeaderOptions {
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

type CsrfDecision =
  | { allow: true; signal: 'sec-fetch-site' | 'origin' | 'referer' | 'no-headers-allowed' }
  | {
      allow: false
      signal: 'sec-fetch-site' | 'origin' | 'referer' | 'no-headers' | 'multiple-origin'
      reason: string
    }

/**
 * T5a.2 Phase B slice 2/6 — pure header-only multi-header CSRF logic.
 * Accepts a structural reader (string|undefined-typed getter per header)
 * + a pre-resolved ownOrigin string. EC-10 (multi-Origin) is handled by
 * the caller because the Web Standards `Headers` API collapses multi-
 * value headers — only the IncomingMessage path can observe the attack.
 *
 * Pure logic. Re-used by both wrappers below.
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
  if (inputs.secFetchSite !== undefined) {
    if (inputs.secFetchSite === 'same-origin' || inputs.secFetchSite === 'none') {
      return { allow: true, signal: 'sec-fetch-site' }
    }
    if (inputs.secFetchSite === 'same-site') {
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
    // 'null' from sandboxed iframe is a valid origin per spec
    if (inputs.origin === 'null') return { allow: true, signal: 'origin' }
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
 * Evaluate CSRF for an incoming POST/PUT/PATCH/DELETE request.
 *
 * Check order:
 *   1. Sec-Fetch-Site (modern browser-native; default must be 'same-origin')
 *   2. Origin (compared to own origin + allowlist with wildcards)
 *   3. Referer (parsed for origin; same comparison)
 *   4. All missing → `allowRequestsWithoutOriginCheck` config decides
 *
 * EC-10: if `Origin` header is present multiple times (Node parses as
 * array), reject — RFC 6454 says origin is single-valued.
 */
export function evaluateCsrfMultiHeader(
  req: IncomingMessage,
  options: CsrfMultiHeaderOptions = {},
): CsrfDecision {
  // EC-10: reject if Origin header is multi-valued (only observable on
  // IncomingMessage; Web Standards Headers API collapses to single value).
  const rawOrigin = req.headers.origin
  if (Array.isArray(rawOrigin)) {
    return {
      allow: false,
      signal: 'multiple-origin',
      reason: 'Multiple Origin headers (RFC 6454 violation)',
    }
  }
  const ownOrigin = getOwnOrigin(req, options.trustForwardedHeaders === true)
  return evaluateCsrfMultiHeaderFromInputs(
    {
      secFetchSite: headerAsString(req.headers['sec-fetch-site']),
      origin: typeof rawOrigin === 'string' ? rawOrigin : undefined,
      referer: headerAsString(req.headers.referer),
    },
    ownOrigin,
    options,
  )
}

/**
 * T5a.2 Phase B slice 2/6 — Web-Standards-shaped multi-header CSRF
 * evaluator. Mirror of `evaluateCsrfMultiHeader(req: IncomingMessage)`
 * for the Web `Request` shape. Consumes `request.headers.get(name)`
 * (native Headers API) instead of the Node indexer.
 *
 * **EC-10 note:** the Web `Headers` API collapses multi-value headers
 * into a single comma-separated string at parse time — the multi-Origin
 * attack vector observable on IncomingMessage does NOT exist here. The
 * `'multiple-origin'` decision signal is unreachable on this path by
 * design. (See `headers.getSetCookie()` — `Set-Cookie` is the only
 * multi-value header the Web spec exposes; all others are
 * single-valued at the API layer.)
 *
 * Used by `executeWebRequest` (T5a.2 Phase A) when opts integrate CSRF
 * multi-header policy alongside the simpler `validateCsrfRequest`.
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

function getOwnOrigin(req: IncomingMessage, trustForwarded: boolean): string | undefined {
  let host: string | undefined
  let proto: string | undefined

  if (trustForwarded) {
    host = headerAsString(req.headers['x-forwarded-host']) ?? headerAsString(req.headers.host)
    proto = headerAsString(req.headers['x-forwarded-proto']) ?? 'http'
  } else {
    host = headerAsString(req.headers.host)
    proto = 'http'
  }
  if (host === undefined) return undefined
  return `${proto}://${host}`
}

/**
 * Web-Standards counterpart of getOwnOrigin. Uses native Headers API +
 * the request's URL (which Web Request always populates with the full
 * absolute URL — unlike IncomingMessage where `req.url` is path-only).
 *
 * Precedence (same as IncomingMessage path):
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

function headerAsString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
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
