import type { IncomingMessage, ServerResponse } from 'node:http'

export interface CookieOptions {
  httpOnly?: boolean
  secure?: boolean
  sameSite?: 'strict' | 'lax' | 'none'
  maxAge?: number
  path?: string
  domain?: string
}

/**
 * Parse a `Cookie` header into a Map (RFC 6265 §5.4).
 * - Empty/missing input → empty Map.
 * - Malformed entries (no `=`) skipped silently (defensive).
 * - Duplicate names → last-wins.
 * - Values URL-decoded if possible; raw on decode failure (CR-009 protection).
 *
 * Canonical helper (T3.2 of architecture-review-remediation-plan; PV-4 DRY).
 * Consumed by `getCookie` here AND by `rate-limit/rate-limit-per-route.ts`.
 */
export function parseCookieHeader(header: string | undefined): Map<string, string> {
  const map = new Map<string, string>()
  if (!header) return map
  for (const pair of header.split(';')) {
    const trimmed = pair.trim()
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx)
    const rawValue = trimmed.slice(eqIdx + 1)
    let value: string
    try {
      value = decodeURIComponent(rawValue)
    } catch {
      // Malformed percent-encoding — preserve raw to not lose data,
      // but the consumer is responsible for treating it as untrusted.
      value = rawValue
    }
    map.set(key, value)
  }
  return map
}

export function getCookie(req: IncomingMessage, name: string): string | undefined {
  const cookies = parseCookieHeader(req.headers.cookie)
  const value = cookies.get(name)
  // CR-009 fix: malformed percent-encoding returns raw via parseCookieHeader.
  // If decoding failed in parse, we get the raw value (with %XX intact).
  // Treat that as "unreadable" for the typed getCookie API to preserve the
  // original "treat as unauthenticated" semantics.
  if (value === undefined) return undefined
  // Sanity: if rawValue contains lone `%` that didn't decode, parseCookieHeader
  // returned the raw — return undefined to preserve old getCookie contract.
  if (/(?:%[^0-9A-Fa-f])|(?:%[0-9A-Fa-f]$)/.test(value)) return undefined
  return value
}

/**
 * T5a.2 Phase B slice 6/6 — pure Set-Cookie serializer. Extracted from
 * `setCookie(res, ...)` so the IncomingMessage path AND the Web Headers
 * path can share the cookie attribute composition.
 *
 * Returns the canonical `Set-Cookie` header value string (no surrounding
 * `Set-Cookie:` prefix — caller wraps via `res.setHeader('Set-Cookie', ...)`
 * or `headers.append('Set-Cookie', ...)`).
 *
 * Defaults: `httpOnly: true`, `secure: NODE_ENV === 'production'`,
 * `sameSite: 'lax'`, `path: '/'`.
 */
export function serializeCookie(name: string, value: string, options?: CookieOptions): string {
  const opts: Required<Omit<CookieOptions, 'maxAge' | 'domain'>> &
    Pick<CookieOptions, 'maxAge' | 'domain'> = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    ...options,
  }

  const parts = [`${name}=${encodeURIComponent(value)}`]
  if (opts.httpOnly) parts.push('HttpOnly')
  if (opts.secure) parts.push('Secure')
  const sameSiteCanonical = opts.sameSite.charAt(0).toUpperCase() + opts.sameSite.slice(1)
  parts.push(`SameSite=${sameSiteCanonical}`)
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`)
  if (opts.path) parts.push(`Path=${opts.path}`)
  if (opts.domain) parts.push(`Domain=${opts.domain}`)
  return parts.join('; ')
}

export function setCookie(
  res: ServerResponse,
  name: string,
  value: string,
  options?: CookieOptions,
): void {
  const serialized = serializeCookie(name, value, options)
  // Append to existing Set-Cookie headers (EC-1: don't overwrite)
  const existing = res.getHeader('Set-Cookie')
  let cookies: string[] = []
  if (Array.isArray(existing)) {
    cookies = existing.map(String)
  } else if (existing !== undefined) {
    cookies = [String(existing)]
  }
  cookies.push(serialized)
  res.setHeader('Set-Cookie', cookies)
}

export function deleteCookie(res: ServerResponse, name: string, options?: { path?: string }): void {
  setCookie(res, name, '', { maxAge: 0, path: options?.path ?? '/' })
}

/**
 * T5a.2 Phase B slice 6/6 — Web-Standards cookie getter.
 *
 * Mirror of `getCookie(req: IncomingMessage, name)` for the Web `Request`
 * shape. Consumes `request.headers.get('cookie')` (native `Headers` API)
 * instead of `req.headers.cookie`. Same parse logic + same malformed
 * percent-encoding sanity (returns undefined when raw value contains a
 * lone `%` that didn't decode, preserving the IncomingMessage path's
 * "treat as unreadable" CR-009 semantics).
 */
export function getCookieFromRequest(request: Request, name: string): string | undefined {
  const cookieHeader = request.headers.get('cookie')
  if (cookieHeader === null) return undefined
  const cookies = parseCookieHeader(cookieHeader)
  const value = cookies.get(name)
  if (value === undefined) return undefined
  if (/(?:%[^0-9A-Fa-f])|(?:%[0-9A-Fa-f]$)/.test(value)) return undefined
  return value
}

/**
 * T5a.2 Phase B slice 6/6 — Web-Standards cookie setter.
 *
 * Mirror of `setCookie(res, name, value, options)` for the Web `Headers`
 * shape. Appends a `Set-Cookie` entry to the caller's `Headers` instance
 * via `headers.append('Set-Cookie', ...)`. Multiple appends produce
 * multiple `Set-Cookie` headers per the Web spec; `headers.getSetCookie()`
 * retrieves them as an array (the one multi-value header the Web API
 * exposes natively).
 *
 * Uses the shared `serializeCookie` pure helper — same defaults and
 * attribute composition as the IncomingMessage path.
 */
export function appendCookieToHeaders(
  target: Headers,
  name: string,
  value: string,
  options?: CookieOptions,
): void {
  target.append('Set-Cookie', serializeCookie(name, value, options))
}

/**
 * T5a.2 Phase B slice 6/6 — Web-Standards cookie deleter.
 *
 * Mirror of `deleteCookie(res, name, options)` — emits a Set-Cookie with
 * `Max-Age=0` so the browser drops the cookie immediately.
 */
export function appendDeleteCookieToHeaders(
  target: Headers,
  name: string,
  options?: { path?: string },
): void {
  appendCookieToHeaders(target, name, '', { maxAge: 0, path: options?.path ?? '/' })
}
