import type { IncomingMessage } from 'node:http'

import { InMemoryStore, type RateLimitStore } from './rate-limit-store.js'

/**
 * Rate limit configuration — basic single-bucket shape. Per ADR D2, the
 * per-route + per-user variant is layered on top via T2.2; this base
 * struct is the smallest unit.
 */
export interface RateLimitConfig {
  windowMs: number
  max: number
}

export interface RateLimitResult {
  limited: boolean
  headers: Record<string, string>
}

/**
 * Create a rate limiter that consumes a pluggable `RateLimitStore`.
 *
 * Backwards-compatible signature: callers passing only `config` get the
 * default `InMemoryStore`. Distributed deployments pass a Redis adapter
 * (or any other `RateLimitStore` implementation) via `opts.store`.
 *
 * T2.1: synchronous return for back-compat with the current
 * `api-middleware.ts` integration point. The async store contract is
 * exercised lazily — we use a sync fast-path against the in-memory store
 * (single-thread JS makes this safe). External stores remain async and
 * would require a different async wrapper at the middleware layer.
 */
export function createRateLimiter(config: RateLimitConfig, opts: { store?: RateLimitStore } = {}) {
  const store = opts.store ?? new InMemoryStore()
  const isInMemory = store instanceof InMemoryStore

  return function checkRateLimit(req: IncomingMessage): RateLimitResult {
    // `req.socket` is typed as always-present in Node typings; defensive
    // for test doubles (object literals without `socket`).
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- defensive for test doubles
    const key = req.socket?.remoteAddress ?? 'unknown'

    if (isInMemory) {
      // Sync fast-path: the in-memory store exposes a sync incr.
      const state = store.incrSync(key, config.windowMs)
      return resultFromState(state, config)
    }

    // External stores are NOT supported via this synchronous façade in
    // 0.3.x. Users plugging Redis adapters today must wire it via a
    // dedicated async middleware path (out-of-scope for T2.1; tracked
    // for the follow-up `@theokit/rate-limit-redis` package).
    throw new Error(
      'createRateLimiter: async RateLimitStore implementations are not supported by this sync façade. ' +
        'Use the InMemoryStore default or build a custom middleware around the async store directly.',
    )
  }
}

function resultFromState(
  state: { count: number; resetAt: number },
  config: RateLimitConfig,
): RateLimitResult {
  if (state.count > config.max) {
    const retryAfter = Math.ceil((state.resetAt - Date.now()) / 1000)
    return {
      limited: true,
      headers: {
        'X-RateLimit-Limit': String(config.max),
        'X-RateLimit-Remaining': '0',
        'Retry-After': String(retryAfter),
      },
    }
  }
  return {
    limited: false,
    headers: {
      'X-RateLimit-Limit': String(config.max),
      'X-RateLimit-Remaining': String(Math.max(0, config.max - state.count)),
    },
  }
}

/**
 * T5a.2 Phase D slice 2/3 — Web-Standards single-bucket rate limiter.
 *
 * Mirror of `createRateLimiter(config, opts)` returning a checker that
 * accepts `(clientIp: string)` instead of `(req: IncomingMessage)`. Web
 * `Request` has no `req.socket.remoteAddress` — the IP is resolved by
 * the caller per-runtime (Node adapter from socket; CF Workers from
 * `cf-connecting-ip`; etc., same convention as Phase D slice 1/3's
 * `DeriveKeyRequestContext.clientIp`).
 *
 * Same `RateLimitConfig`, same `InMemoryStore` default, same async
 * store rejection (use a dedicated async middleware for external stores).
 * Same `RateLimitResult` return shape.
 *
 * **Signature difference from `createRateLimiter`:** this Web factory's
 * checker takes a raw IP string instead of a Request object. The IP is
 * the ONLY input the bucket needs; passing a Request object would force
 * the caller to populate `request.headers.get('x-forwarded-for')` or
 * similar without giving us any safer extraction. KISS — accept the IP
 * directly, document the per-runtime resolution at the adapter boundary.
 */
export function createRateLimiterWeb(
  config: RateLimitConfig,
  opts: { store?: RateLimitStore } = {},
) {
  const store = opts.store ?? new InMemoryStore()
  const isInMemory = store instanceof InMemoryStore

  return function checkRateLimitWeb(clientIp: string): RateLimitResult {
    const key = clientIp.length > 0 ? clientIp : 'unknown'
    if (isInMemory) {
      const state = store.incrSync(key, config.windowMs)
      return resultFromState(state, config)
    }
    throw new Error(
      'createRateLimiterWeb: async RateLimitStore implementations are not supported by this sync façade. ' +
        'Use the InMemoryStore default or build a custom middleware around the async store directly.',
    )
  }
}
