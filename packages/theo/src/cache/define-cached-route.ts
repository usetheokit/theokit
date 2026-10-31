import type { z } from 'zod'

import type { RouteConfig } from '../core/contracts/route-config.js'

import { getCacheControlHeader } from './cache-control-header.js'
import type { CacheEngine, CacheStatus } from './cache-engine.js'
import { THEO_T_PREFIX } from './constants.js'
import { deriveKey } from './key-derivation.js'
import type { CacheEntry } from './storage-adapter.js'
import { validateExpire, validateMaxAge, validateTags } from './validation.js'

/** Default 10 MB cap per cached route entry (EC-3). */
export const DEFAULT_MAX_ENTRY_SIZE = 10 * 1024 * 1024
const VARIES_IGNORED = new Set(['cookie', 'set-cookie'])

export interface RouteCacheOptions {
  maxAge?: number
  swr?: number
  tags?: string[]
  varies?: string[]
  getKey?: (req: Request) => string | Promise<string>
  bypassWhen?: (req: Request) => boolean | Promise<boolean>
  cacheVersion?: string
  cacheErrors?: boolean
  methods?: string[]
  cacheable?: (response: Response) => boolean
  /** Max body bytes (EC-3); default DEFAULT_MAX_ENTRY_SIZE. */
  maxEntrySize?: number
}

export interface CachedRouteConfig<
  TQuery extends z.ZodType = z.ZodUndefined,
  TBody extends z.ZodType = z.ZodUndefined,
  TParams extends z.ZodType = z.ZodUndefined,
  TCtx = unknown,
> extends Omit<RouteConfig<TQuery, TBody, TParams, TCtx>, 'handler'> {
  cache: RouteCacheOptions
  handler: (ctx: {
    query: z.infer<TQuery>
    body: z.infer<TBody>
    params: z.infer<TParams>
    request: Request
    ctx: TCtx
  }) => unknown
}

interface RouteCacheValue {
  body: string
  status: number
  headers: [string, string][]
}

const setCookieWarnedRoutes = new WeakSet()
const variesCookieWarnedRoutes = new WeakSet()
const oversizedWarnedRoutes = new WeakSet()
const revalidateFailureWarnedRoutes = new WeakSet()

/**
 * Wrap a `RouteConfig` with cache-aware handler logic.
 *
 * Architecture: wraps the user `handler` so cache lookup happens AT
 * handler-invocation time, AFTER router middleware (auth/csrf/etc) ran.
 * This structurally satisfies EC-4 (cache-after-auth) without modifying
 * the router internals.
 *
 * Algorithm per request:
 * 1. Method check + bypassWhen + maxAge=0 → call handler raw
 * 2. Derive key (path + sortedQuery + varies, prefix by method)
 * 3. Cache lookup → HIT/STALE return cached Response
 * 4. Miss → run handler, check cacheability (Set-Cookie / status / size / SSE / streaming)
 * 5. Cacheable → write entry + return Response with X-Theo-Cache: MISS
 * 6. Not cacheable → return original Response unchanged
 *
 * Requests are single-flight per cache key (B-667), per process and per
 * `defineCachedRoute` call: concurrent misses of one key share one handler run. The leader's `Response` is never shared (single-use body):
 * each follower builds its own `Response` from the cached value, with
 * X-Theo-Cache: MISS. When the leader's response is not cacheable (Set-Cookie,
 * stream, error status, `cacheable` refusing it), it stays the leader's own and
 * each follower runs the handler itself. A thrown leader rejects its followers
 * with the same error, unless the leader's own request signal was aborted; a
 * Node IncomingMessage arrives here without a signal, so that exception does not
 * apply to it. A stale key starts one background revalidation at a time; a failed
 * one keeps the stale entry and is reported once per route with `console.warn`,
 * naming the method and path (never the key, which carries request data).
 */
export function defineCachedRoute<
  TQuery extends z.ZodType = z.ZodUndefined,
  TBody extends z.ZodType = z.ZodUndefined,
  TParams extends z.ZodType = z.ZodUndefined,
  TCtx = unknown,
>(
  engine: CacheEngine,
  config: CachedRouteConfig<TQuery, TBody, TParams, TCtx>,
): RouteConfig<TQuery, TBody, TParams, TCtx, Response> {
  const { cache, handler, ...rest } = config

  // #352 — anything the route leaves undeclared falls back to the engine's
  // process-wide defaults; anything the route declares wins over them.
  const defaults = engine.defaults
  const maxAge = validateMaxAge(cache.maxAge ?? defaults.maxAge, 'defineCachedRoute')
  const swr = validateExpire(cache.swr ?? defaults.swr, maxAge, 'defineCachedRoute')
  const cacheVersion = cache.cacheVersion ?? defaults.cacheVersion
  const cacheErrors = cache.cacheErrors ?? defaults.cacheErrors ?? false
  if (cacheVersion === '') {
    throw new Error('defineCachedRoute: cacheVersion must be non-empty if provided')
  }
  // EC-19: maxEntrySize validation
  const maxEntrySize = cache.maxEntrySize ?? DEFAULT_MAX_ENTRY_SIZE
  if (!Number.isFinite(maxEntrySize) || maxEntrySize < 0) {
    throw new Error(
      `Invalid maxEntrySize "${String(cache.maxEntrySize)}" in defineCachedRoute, must be a non-negative finite number`,
    )
  }
  const methods = new Set((cache.methods ?? ['GET', 'HEAD']).map((m) => m.toUpperCase()))
  const baseTags = validateTags(cache.tags ?? [], 'defineCachedRoute').valid

  // EC-2: filter cookie/set-cookie from varies + warn-once per route
  const variesRaw = cache.varies ?? []
  const variesLower = variesRaw.map((v) => v.toLowerCase())
  const hadCookieVary = variesLower.some((v) => VARIES_IGNORED.has(v))
  const safeVaries = variesLower.filter((v) => !VARIES_IGNORED.has(v))
  if (hadCookieVary && !variesCookieWarnedRoutes.has(config)) {
    variesCookieWarnedRoutes.add(config)
    console.warn(
      `[theokit:cache] defineCachedRoute: 'cookie'/'set-cookie' removed from varies — they fragment cache to zero hit rate (EC-2)`,
    )
  }

  // B-667 — per-route, per-key: the leader's outcome while its handler runs.
  const inFlight = new Map<string, Promise<LeaderOutcome>>()
  // B-667 — keys whose background revalidation is running.
  const revalidating = new Set<string>()

  const wrappedHandler = async (ctx: {
    query: z.infer<TQuery>
    body: z.infer<TBody>
    params: z.infer<TParams>
    request: Request
    ctx: TCtx
  }): Promise<Response> => {
    // TheoKit's dispatcher may pass a Node IncomingMessage (not a Web Request).
    // Normalize to a Web Request so deriveKey / bypassWhen / URL parsing work uniformly.
    const webRequest = toWebRequest(ctx.request)

    if (!methods.has(webRequest.method.toUpperCase())) {
      return invokeHandlerAsResponse(handler, ctx)
    }
    if (cache.bypassWhen && (await cache.bypassWhen(webRequest))) {
      return invokeHandlerAsResponse(handler, ctx)
    }
    if (maxAge === 0) {
      return invokeHandlerAsResponse(handler, ctx)
    }

    const key = await deriveKey(webRequest, {
      prefix: 'route:' + webRequest.method.toUpperCase(),
      varies: safeVaries,
      getKey: cache.getKey,
    })

    // ---- Cache lookup (T4.2 DRY — delegates to engine canonical) ----
    const cached = await engine.tryReadCached<RouteCacheValue>(key, {
      cacheVersion,
    })

    // T4.3 — build options bag once; pass to all helpers (≤ 4 params each).
    const routeCacheCtx: RouteCacheCtx = {
      engine,
      key,
      cache,
      routeConfig: config,
      maxEntrySize,
      maxAge,
      swr,
      cacheVersion,
      cacheErrors,
      baseTags,
      webRequest,
      inFlight,
      revalidating,
    }

    if (cached) {
      if (cached.status === 'hit') {
        return buildResponseFromCache(cached.value, 'hit', maxAge, swr)
      }
      // Only 'stale' remains (engine never returns 'miss' from tryReadCached).
      // Stale: schedule background refresh + return stale immediately.
      scheduleRouteRevalidate(routeCacheCtx, handler, ctx)
      return buildResponseFromCache(cached.value, 'stale', maxAge, swr)
    }

    // ---- Miss: one handler run per key (B-667) ----
    return runMissSingleFlight(routeCacheCtx, handler, ctx)
  }

  return {
    ...rest,
    handler: wrappedHandler,
  }
}

// T4.2 (PV-5 DRY): tryReadCacheEntry was removed — duplicated the engine's
// canonical tryReadCached (staleness check, version check, JSON parse,
// clock-skew clamp). Route wrapper now delegates to `engine.tryReadCached`.

/**
 * T4.3 options-bag context (PV-6 — Clean Code consensus ≤ 4 params).
 * Collapses 10/11 positional params of `persistOutcome` and
 * `scheduleRouteRevalidate` to 2 params each (ctx + payload).
 *
 * Some fields are derived from `cache` config (EC-22 documented redundancy) —
 * the trade-off is O(1) construction per request for vastly simpler call
 * sites and safer additions of new fields without reordering args.
 */
interface RouteCacheCtx {
  engine: CacheEngine
  key: string
  cache: RouteCacheOptions
  routeConfig: object
  maxEntrySize: number
  maxAge: number
  swr: number | undefined
  /** Resolved against `engine.defaults` at define time (#352). */
  cacheVersion: string | undefined
  /** Resolved against `engine.defaults` at define time (#352). */
  cacheErrors: boolean
  baseTags: string[]
  webRequest: Request
  /** The route's miss slots, keyed by cache key (B-667). */
  inFlight: Map<string, Promise<LeaderOutcome>>
  /** The route's keys under background revalidation (B-667). */
  revalidating: Set<string>
}

/**
 * What a miss leader hands its followers. Never the leader's `Response`: its body
 * is single-use, and an uncacheable one (a `Set-Cookie`) belongs to its own request.
 */
type LeaderOutcome = { kind: 'cached'; value: RouteCacheValue } | { kind: 'uncacheable' }

async function runMissSingleFlight<THandlerCtx>(
  ctx: RouteCacheCtx,
  handler: (handlerCtx: THandlerCtx) => unknown,
  handlerCtx: THandlerCtx,
): Promise<Response> {
  // The check and the claim run with no await between them, so the next caller sees the slot.
  const pending = ctx.inFlight.get(ctx.key)
  if (pending) {
    const outcome = await pending
    if (outcome.kind === 'cached') {
      return buildResponseFromCache(outcome.value, 'miss', ctx.maxAge, ctx.swr)
    }
    const own = await persistOutcome(ctx, await invokeHandlerAsResponse(handler, handlerCtx))
    return own.response
  }
  let publish!: (outcome: LeaderOutcome) => void
  let fail!: (err: unknown) => void
  const slot = new Promise<LeaderOutcome>((resolve, reject) => {
    publish = resolve
    fail = reject
  })
  // A leader with no follower must not raise an unhandled rejection.
  slot.catch(() => undefined)
  ctx.inFlight.set(ctx.key, slot)
  try {
    const { response, value } = await persistOutcome(
      ctx,
      await invokeHandlerAsResponse(handler, handlerCtx),
    )
    publish(value ? { kind: 'cached', value } : { kind: 'uncacheable' })
    return response
  } catch (err) {
    // The leader's client went away: its error is not taken as the followers' cause, and
    // each follower runs the handler itself. A shared failure that happens to land after
    // the abort is re-run by the followers rather than shared (bounded, EC-1). A Node
    // IncomingMessage reaches here as a signal-less Request, so this cannot fire there.
    if (ctx.webRequest.signal.aborted) publish({ kind: 'uncacheable' })
    else fail(err)
    throw err
  } finally {
    ctx.inFlight.delete(ctx.key)
  }
}

function buildRouteCacheEntry(value: RouteCacheValue, ctx: RouteCacheCtx): CacheEntry {
  const pathTag = THEO_T_PREFIX + new URL(ctx.webRequest.url).pathname
  return {
    body: JSON.stringify(value),
    status: 200,
    headers: [],
    storedAt: Date.now(),
    maxAge: ctx.maxAge,
    swr: ctx.swr ?? ctx.maxAge * 60,
    tags: [...ctx.baseTags, pathTag],
    cacheVersion: ctx.cacheVersion,
  }
}

/** Write a cacheable response; `value` is set only when it was written. */
async function persistOutcome(
  ctx: RouteCacheCtx,
  response: Response,
): Promise<{ response: Response; value?: RouteCacheValue }> {
  const value = await tryCacheResponse(response, ctx)
  if (!value) {
    // Not cached — return original response unchanged
    return { response }
  }
  await ctx.engine.set(ctx.key, buildRouteCacheEntry(value, ctx))
  return { response: buildResponseFromCache(value, 'miss', ctx.maxAge, ctx.swr), value }
}

function scheduleRouteRevalidate<THandlerCtx>(
  ctx: RouteCacheCtx,
  handler: (handlerCtx: THandlerCtx) => unknown,
  handlerCtx: THandlerCtx,
): void {
  // One revalidation per key at a time, released when it settles. One that never settles
  // keeps the key claimed: later stale windows of that key get no background refresh,
  // and only a miss after the swr window refills the entry (no timeout bounds the claim).
  if (ctx.revalidating.has(ctx.key)) return
  ctx.revalidating.add(ctx.key)
  void (async () => {
    try {
      await persistOutcome(ctx, await invokeHandlerAsResponse(handler, handlerCtx))
    } catch (err) {
      // The stale entry stays and the next stale hit retries. Reported once per route, so
      // a handler that keeps failing in the background is visible without flooding the log.
      // The message names the method and path, never the key: the key carries the query
      // string and every varied header value, an Authorization header among them (CWE-532).
      if (!revalidateFailureWarnedRoutes.has(ctx.routeConfig)) {
        revalidateFailureWarnedRoutes.add(ctx.routeConfig)
        const { pathname } = new URL(ctx.webRequest.url)
        console.warn(
          `[theokit:cache] background revalidation failed for ${ctx.webRequest.method} ${pathname}; serving stale until it succeeds`,
          err,
        )
      }
    } finally {
      ctx.revalidating.delete(ctx.key)
    }
  })()
}

/**
 * Type for Node.js IncomingMessage (subset we read).
 * Avoids a direct `node:http` import which would block edge runtimes.
 */
interface NodeLikeRequest {
  url?: string
  method?: string
  headers: Record<string, string | string[] | undefined>
  socket?: { encrypted?: boolean }
}

/**
 * Adapt either a Web Request or a Node IncomingMessage to a Web Request.
 * TheoKit's runtime dispatch may pass either depending on the adapter.
 */

// Node IncomingMessage) inside one function so the call sites stay shape-blind.
function toWebRequest(req: Request | NodeLikeRequest): Request {
  // Web Request fast-path
  if (typeof (req as Request).clone === 'function' && (req as Request).headers instanceof Headers) {
    return req as Request
  }
  const node = req as NodeLikeRequest
  const host = (typeof node.headers.host === 'string' ? node.headers.host : null) ?? 'localhost'
  const protocol = node.socket?.encrypted ? 'https' : 'http'
  const path = node.url ?? '/'
  const url = path.startsWith('http') ? path : `${protocol}://${host}${path}`
  const headers = new Headers()
  for (const [k, v] of Object.entries(node.headers)) {
    if (Array.isArray(v)) {
      for (const item of v) headers.append(k, item)
    } else if (typeof v === 'string') {
      headers.set(k, v)
    }
  }
  return new Request(url, {
    method: (node.method ?? 'GET').toUpperCase(),
    headers,
  })
}

async function invokeHandlerAsResponse<TCtx>(
  handler: (ctx: TCtx) => unknown,
  ctx: TCtx,
): Promise<Response> {
  const raw = await handler(ctx)
  if (raw instanceof Response) return raw
  return Response.json(raw)
}

/**
 * Decide whether `response` is cacheable. Returns serialized form on yes; undefined on no.
 * Order matters: cheap checks first, body read last (only for cacheable candidates).
 */
async function tryCacheResponse(
  response: Response,
  ctx: RouteCacheCtx,
): Promise<RouteCacheValue | undefined> {
  const { cache, routeConfig, maxEntrySize } = ctx
  // D7 / EC-2: Set-Cookie auto-bypass
  if (response.headers.has('set-cookie')) {
    if (!setCookieWarnedRoutes.has(routeConfig)) {
      setCookieWarnedRoutes.add(routeConfig)
      console.warn('[theokit:cache] response has Set-Cookie — skipping cache write (D7)')
    }
    return undefined
  }
  // SSE
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('text/event-stream')) return undefined
  // EC-11: chunked streaming (transfer-encoding: chunked OR no content-length on a
  // user-constructed Response — i.e., a Response built from a ReadableStream that
  // wasn't via Response.json/text helpers). We detect via the explicit
  // transfer-encoding header since Response.json() also uses a ReadableStream
  // body internally and we don't want to refuse those.
  if (response.headers.get('transfer-encoding')?.toLowerCase() === 'chunked') {
    return undefined
  }
  // D9: status >= 400 not cached unless opt-in
  if (response.status >= 400 && !ctx.cacheErrors) return undefined
  // Custom predicate (overrides built-ins)
  if (cache.cacheable && !cache.cacheable(response)) return undefined

  // Read body (clone to preserve the response for downstream)
  const text = await response.clone().text()

  // EC-3: oversized bypass
  if (text.length > maxEntrySize) {
    if (!oversizedWarnedRoutes.has(routeConfig)) {
      oversizedWarnedRoutes.add(routeConfig)
      console.warn(
        `[theokit:cache] response body ${text.length} bytes exceeds maxEntrySize ${maxEntrySize}; skipping cache (EC-3)`,
      )
    }
    return undefined
  }

  const headers: [string, string][] = []
  response.headers.forEach((v, k) => {
    if (k.toLowerCase() === 'set-cookie') return // defense-in-depth
    headers.push([k, v])
  })
  return { body: text, status: response.status, headers }
}

/**
 * The one signal that tells a caller a hit from a miss.
 *
 * It used to be written only when `process.env.NODE_ENV !== 'production'`, and
 * every real deploy sets exactly that — so the signal existed in development and
 * vanished in the place where anyone needed to check whether the cache was
 * working (#352).
 *
 * It is emitted unconditionally rather than behind a config flag. The value is
 * one of three fixed words derived from the lookup outcome alone: it carries no
 * key, no tag, no cache version and nothing derived from the request or from the
 * cached body. Entries are shared by construction — `cookie` is stripped from
 * `varies` and a response carrying `Set-Cookie` is never written — so a `HIT`
 * says a URL was fetched recently and cannot say by whom. Publishing cache
 * status in production is what every CDN in front of this framework already does
 * (`X-Cache`, `CF-Cache-Status`, and the `Cache-Status` header of RFC 9211).
 */
function toCacheStatusHeader(status: CacheStatus): 'HIT' | 'STALE' | 'MISS' {
  if (status === 'hit') return 'HIT'
  if (status === 'stale') return 'STALE'
  return 'MISS'
}

function buildResponseFromCache(
  value: RouteCacheValue,
  status: CacheStatus,
  maxAge: number,
  swr: number | undefined,
): Response {
  const headers = new Headers(value.headers)
  if (!headers.has('cache-control')) {
    headers.set('cache-control', getCacheControlHeader({ maxAge, swr: swr ?? maxAge * 60 }))
  }
  headers.set('X-Theo-Cache', toCacheStatusHeader(status))
  return new Response(value.body, { status: value.status, headers })
}
