// T5a.1d — Web Crypto migration. The last node:crypto consumer in server/.
// `createHash('sha256')` is sync but Web Crypto's `subtle.digest('SHA-256', ...)`
// is async. This propagates through hashFragment → deriveKey → the factory's
// returned checker. createRouteRateLimiter has NO production consumers
// (verified via grep; api-middleware uses the sibling createRateLimiter from
// rate-limit.ts), so the cascade only affects test sites. IncomingMessage stays
// as a type-only import (TS-erased; runtime-clean).
import type { IncomingMessage } from 'node:http'

import { parseCookieHeader } from '../http/cookies.js'

import { InMemoryStore, type RateLimitStore } from './rate-limit-store.js'
import type { RateLimitConfig, RateLimitResult } from './rate-limit.js'

/**
 * T2.2 — Per-route + per-user rate limiting.
 *
 * Layered on top of `rate-limit-store.ts`. The route map allows
 * declarative policies ("strict /api/login, loose everything else")
 * driven by config, not handler-decorated. `keyBy` selects what
 * identifier the limiter buckets on.
 *
 * ADR D2: per-route via path matching, NOT per-handler decorator.
 * Operators can tune policies without touching route definitions.
 */

export type KeyByMode = 'ip' | 'session' | 'user' | ((req: IncomingMessage) => string)

export interface RouteRateLimitConfig {
  /** Fallback config used when no per-route entry matches. */
  default?: RateLimitConfig
  /** Map of path pattern → config. Exact-string keys (RegExp via API). */
  routes?: Record<string, RateLimitConfig>
  /** Same as `routes` but each entry is a [pattern, config] tuple, RegExp allowed. */
  routePatterns?: readonly [string | RegExp, RateLimitConfig][]
  /** Bucket identifier strategy. Default 'ip'. */
  keyBy?: KeyByMode
  /** Cookie name used by keyBy='session'. Defaults to 'theo_session'. */
  cookieName?: string
  /** Optional shared store (for multi-route correlation). Default per-limiter InMemoryStore. */
  store?: RateLimitStore
}

/**
 * Normalize a path for matching: strip query string, drop trailing slash
 * unless root. EC-5: `/api/login` and `/api/login/` collapse to the same
 * canonical form so attackers can't bypass strict limits.
 */
function normalizePath(input: string): string {
  const noQuery = input.split('?')[0]
  if (noQuery.length > 1 && noQuery.endsWith('/')) return noQuery.slice(0, -1)
  return noQuery
}

/**
 * Test whether `path` matches `pattern`. String patterns are compared
 * after trailing-slash normalization (EC-5). RegExp uses `.test` after
 * resetting `lastIndex` (defensive against `/g` flag).
 */
export function matchRoutePattern(path: string, pattern: string | RegExp): boolean {
  const canonical = normalizePath(path)
  if (typeof pattern === 'string') {
    return canonical === normalizePath(pattern)
  }
  pattern.lastIndex = 0
  return pattern.test(canonical)
}

/**
 * Hash a string with SHA-256 and return the first 16 base64url chars.
 * Used by `keyBy='session'` so the raw cookie value never lands in a
 * rate-limit key (which may flow into audit logs).
 *
 * T5a.1d — async via Web Crypto subtle.digest (no node:crypto). The
 * base64url encoding is done manually because btoa+url-safe transform is
 * available everywhere but `digest('base64url')` is Node-only.
 */
async function hashFragment(input: string): Promise<string> {
  const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  const bytes = new Uint8Array(buf)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  // eslint-disable-next-line sonarjs/slow-regex -- input is fixed-length 44 chars (SHA-256 base64), trailing '=' padding ≤ 2 chars, no ReDoS surface
  const b64url = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return b64url.slice(0, 16)
}

// T3.2 DRY consolidation: cookie parsing moved to ../http/cookies.ts.
// The canonical `parseCookieHeader` returns a Map for O(1) lookup; this
// wrapper preserves the original `readCookie(req, name)` signature so the
// rest of the file stays untouched.
function readCookie(req: IncomingMessage, name: string): string | undefined {
  return parseCookieHeader(req.headers.cookie ?? undefined).get(name)
}

/**
 * Build the rate-limit bucket key for the request based on `keyBy`.
 *
 * EC-6: session mode reads the configured `cookieName`. With the wrong
 * cookie name (e.g., default 'theo_session' but app uses 'app_session'),
 * we fall back to IP so anonymous users still get rate-limited rather
 * than sharing an empty bucket.
 */
export async function deriveKey(
  req: IncomingMessage,
  keyBy: KeyByMode,
  cookieName: string,
): Promise<string> {
  if (typeof keyBy === 'function') return keyBy(req)
  // `req.socket` is typed as always-present in Node typings, but in test
  // doubles (object literals without `socket`) it can be missing — the
  // optional chain keeps the fallback path reachable.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- defensive for test doubles
  const ip = req.socket?.remoteAddress ?? 'unknown'
  switch (keyBy) {
    case 'session': {
      const cookie = readCookie(req, cookieName)
      return cookie ? `session:${await hashFragment(cookie)}` : `ip:${ip}`
    }
    case 'user': {
      const userId = (req as unknown as { user?: { id?: string } }).user?.id
      return userId ? `user:${userId}` : `ip:${ip}`
    }
    case 'ip':
    default:
      return `ip:${ip}`
  }
}

/**
 * Per-route rate limiter factory. Returns a sync checker compatible with
 * the existing api-middleware shape.
 *
 * Backwards-compatibility (ADR D2): a flat `{ windowMs, max }` config is
 * accepted and treated as `default` (no per-route variants).
 */
export function createRouteRateLimiter(config: RouteRateLimitConfig | RateLimitConfig) {
  // Detect legacy flat shape
  const isFlat =
    'windowMs' in config && 'max' in config && !('default' in config) && !('routes' in config)
  const cfg: RouteRateLimitConfig = isFlat ? { default: config } : config

  const store = cfg.store ?? new InMemoryStore()
  // CR-005: validate store shape ONCE at construction. The previous
  // implementation ran `instanceof InMemoryStore` on every request and
  // threw at request-time if a non-InMemoryStore was passed — which
  // turned a clear config error into a runtime 500 on the first request.
  if (!(store instanceof InMemoryStore)) {
    throw new Error(
      'createRouteRateLimiter: async RateLimitStore implementations require a dedicated async middleware path. ' +
        'Use the InMemoryStore default for the sync façade.',
    )
  }
  const inMemoryStore = store
  const keyBy = cfg.keyBy ?? 'ip'
  const cookieName = cfg.cookieName ?? 'theo_session'

  // Build a pre-compiled list of (pattern, config) tuples for matching.
  const patternList: [string | RegExp, RateLimitConfig][] = []
  if (cfg.routes) {
    for (const [pattern, c] of Object.entries(cfg.routes)) patternList.push([pattern, c])
  }
  if (cfg.routePatterns) {
    for (const tuple of cfg.routePatterns) patternList.push(tuple)
  }

  return async function checkRouteRateLimit(req: IncomingMessage): Promise<RateLimitResult> {
    const url = req.url ?? ''
    let matched: RateLimitConfig | undefined
    for (const [pattern, c] of patternList) {
      if (matchRoutePattern(url, pattern)) {
        matched = c
        break
      }
    }
    const effective = matched ?? cfg.default
    if (!effective) {
      // No route match + no default → not limited.
      return { limited: false, headers: {} }
    }

    // Bucket key includes normalized path so /api/login and /api/login/
    // collapse to the same bucket (EC-5).
    const bucketSuffix = typeof matched === 'undefined' ? '*default*' : normalizePath(url)
    const key = `${await deriveKey(req, keyBy, cookieName)}|${bucketSuffix}`
    const state = inMemoryStore.incrSync(key, effective.windowMs)

    if (state.count > effective.max) {
      const retryAfter = Math.ceil((state.resetAt - Date.now()) / 1000)
      return {
        limited: true,
        headers: {
          'X-RateLimit-Limit': String(effective.max),
          'X-RateLimit-Remaining': '0',
          'Retry-After': String(retryAfter),
        },
      }
    }
    return {
      limited: false,
      headers: {
        'X-RateLimit-Limit': String(effective.max),
        'X-RateLimit-Remaining': String(Math.max(0, effective.max - state.count)),
      },
    }
  }
}

/**
 * T5a.2 Phase D slice 1/3 — Web-Standards rate-limiter inputs context.
 *
 * Web `Request` has no equivalent of `req.socket.remoteAddress` (Node
 * runtime concept) or `req.user` (set by upstream middleware). The
 * Web-shaped rate-limiter requires the caller to pass these explicitly:
 *
 *   - `clientIp` — resolved per-runtime (Node: `socket.remoteAddress`;
 *     CF Workers: `request.headers.get('cf-connecting-ip')`; Vercel:
 *     `x-forwarded-for` first hop; Bun/Deno: adapter-specific).
 *   - `userId` — resolved by auth middleware (Phase D slice 3/3 ships
 *     the Web-shaped session helper).
 *
 * Defaults: `clientIp = 'unknown'`, `userId = undefined` (matches the
 * IncomingMessage path's fallback semantics).
 */
export interface DeriveKeyRequestContext {
  clientIp?: string
  userId?: string
}

/**
 * T5a.2 Phase D slice 1/3 — Web-Standards-shaped key derivation.
 *
 * Mirror of `deriveKey(req: IncomingMessage, keyBy, cookieName)` for the
 * Web `Request` shape. Same `'ip' | 'session' | 'user'` enum cases (the
 * `function` callback case is IncomingMessage-only because the existing
 * `KeyByMode` callback type is Node-shaped; Web callers use the enum
 * cases or call a future `KeyByModeWeb` shape — out of T5a.2 Phase D scope).
 *
 * Uses `getCookieFromRequest` (Phase B slice 6/6) for session-mode cookie
 * lookup. Cookie parsing has the same CR-009 percent-encoding safety.
 */
export async function deriveKeyFromRequest(
  request: Request,
  keyBy: Exclude<KeyByMode, (req: IncomingMessage) => string>,
  cookieName: string,
  ctx: DeriveKeyRequestContext = {},
): Promise<string> {
  const ip = ctx.clientIp ?? 'unknown'
  switch (keyBy) {
    case 'session': {
      // Reuse the Web cookie helper extracted in Phase B slice 6/6 so
      // CR-009 percent-encoding sanity stays consistent across paths.
      const { getCookieFromRequest } = await import('../http/cookies.js')
      const cookie = getCookieFromRequest(request, cookieName)
      return cookie ? `session:${await hashFragment(cookie)}` : `ip:${ip}`
    }
    case 'user': {
      return ctx.userId ? `user:${ctx.userId}` : `ip:${ip}`
    }
    case 'ip':
    default:
      return `ip:${ip}`
  }
}

/**
 * T5a.2 Phase D slice 1/3 — Web-Standards rate-limiter factory.
 *
 * Mirror of `createRouteRateLimiter(config)` returning a checker that
 * accepts `(request: Request, ctx?: DeriveKeyRequestContext)` instead of
 * `(req: IncomingMessage)`. Same `RouteRateLimitConfig` accepted; same
 * `keyBy` enum cases; same `InMemoryStore` constraint (CR-005 guard).
 *
 * Same returned `RateLimitResult` shape (headers + limited boolean).
 *
 * Web `Request` has no `req.url` path-only property — uses
 * `new URL(request.url).pathname + search` to derive the URL the way the
 * IncomingMessage path's `req.url ?? ''` would.
 */
export function createRouteRateLimiterWeb(config: RouteRateLimitConfig | RateLimitConfig) {
  const isFlat =
    'windowMs' in config && 'max' in config && !('default' in config) && !('routes' in config)
  const cfg: RouteRateLimitConfig = isFlat ? { default: config } : config

  const store = cfg.store ?? new InMemoryStore()
  if (!(store instanceof InMemoryStore)) {
    throw new Error(
      'createRouteRateLimiterWeb: async RateLimitStore implementations require a dedicated async middleware path. ' +
        'Use the InMemoryStore default for the Web façade.',
    )
  }
  const inMemoryStore = store
  const keyBy = (cfg.keyBy ?? 'ip') as Exclude<KeyByMode, (req: IncomingMessage) => string>
  const cookieName = cfg.cookieName ?? 'theo_session'

  const patternList: [string | RegExp, RateLimitConfig][] = []
  if (cfg.routes) {
    for (const [pattern, c] of Object.entries(cfg.routes)) patternList.push([pattern, c])
  }
  if (cfg.routePatterns) {
    for (const tuple of cfg.routePatterns) patternList.push(tuple)
  }

  return async function checkRouteRateLimitWeb(
    request: Request,
    ctx: DeriveKeyRequestContext = {},
  ): Promise<RateLimitResult> {
    // Web Request guarantees absolute URL — extract path+query for pattern
    // matching (mirror of IncomingMessage's `req.url ?? ''`).
    const parsed = new URL(request.url)
    const url = `${parsed.pathname}${parsed.search}`
    let matched: RateLimitConfig | undefined
    for (const [pattern, c] of patternList) {
      if (matchRoutePattern(url, pattern)) {
        matched = c
        break
      }
    }
    const effective = matched ?? cfg.default
    if (!effective) {
      return { limited: false, headers: {} }
    }

    const bucketSuffix = typeof matched === 'undefined' ? '*default*' : normalizePath(url)
    const key = `${await deriveKeyFromRequest(request, keyBy, cookieName, ctx)}|${bucketSuffix}`
    const state = inMemoryStore.incrSync(key, effective.windowMs)

    if (state.count > effective.max) {
      const retryAfter = Math.ceil((state.resetAt - Date.now()) / 1000)
      return {
        limited: true,
        headers: {
          'X-RateLimit-Limit': String(effective.max),
          'X-RateLimit-Remaining': '0',
          'Retry-After': String(retryAfter),
        },
      }
    }
    return {
      limited: false,
      headers: {
        'X-RateLimit-Limit': String(effective.max),
        'X-RateLimit-Remaining': String(Math.max(0, effective.max - state.count)),
      },
    }
  }
}
