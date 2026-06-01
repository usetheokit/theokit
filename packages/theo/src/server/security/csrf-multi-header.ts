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
      signal: 'sec-fetch-site' | 'origin' | 'referer' | 'no-headers' | 'multiple-origin'
      reason: string
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
  const ownOrigin = getOwnOrigin(req, options.trustForwardedHeaders === true)

  // EC-10: reject if Origin header is multi-valued
  const rawOrigin = req.headers.origin
  if (Array.isArray(rawOrigin)) {
    return {
      allow: false,
      signal: 'multiple-origin',
      reason: 'Multiple Origin headers (RFC 6454 violation)',
    }
  }

  // 1. Sec-Fetch-Site
  const secFetchSite = headerAsString(req.headers['sec-fetch-site'])
  if (secFetchSite !== undefined) {
    if (secFetchSite === 'same-origin' || secFetchSite === 'none') {
      return { allow: true, signal: 'sec-fetch-site' }
    }
    if (secFetchSite === 'same-site') {
      return { allow: true, signal: 'sec-fetch-site' }
    }
    return {
      allow: false,
      signal: 'sec-fetch-site',
      reason: `Sec-Fetch-Site header indicates ${secFetchSite}`,
    }
  }

  // 2. Origin
  if (typeof rawOrigin === 'string') {
    // 'null' from sandboxed iframe is a valid origin per spec
    if (rawOrigin === 'null') return { allow: true, signal: 'origin' }
    if (originMatches(rawOrigin, ownOrigin, options.allowedOrigins)) {
      return { allow: true, signal: 'origin' }
    }
    return { allow: false, signal: 'origin', reason: 'Origin not in allowlist' }
  }

  // 3. Referer
  const referer = headerAsString(req.headers.referer)
  if (referer !== undefined) {
    const refererOrigin = safeOriginFromUrl(referer)
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
