/**
 * Phase 3 of G1 (g1-client-codegen-plan.md):
 *
 * `createAppClient(baseUrl?, fetchImpl?)` returns a Proxy that walks property
 * access (`client.posts.id.get(...)`) into a `theoFetch` invocation against
 * `{baseUrl}/posts/{params.id}` with method `GET`.
 *
 * Type safety is delivered by the `.d.ts` file emitted in Phase 2 — this
 * runtime is structurally untyped. Power users may use `theoFetch` directly
 * when they need to escape the Proxy facade.
 *
 * Edge cases absorbed:
 *  - EC-1 (thenable trap): `then` / `catch` / `finally` / `toJSON` / `Symbol.*`
 *    return `undefined` so that accidental `await client.posts` resolves to a
 *    plain Proxy value (it is NOT thenable) instead of looping.
 *  - EC-7 (abort signal): `opts.signal` is spread through to the underlying
 *    fetchImpl unchanged — verified in unit tests.
 *
 * Bundle target: ≤ 2KB gzipped.
 */

import { theoFetch, TheoFetchError } from './theo-fetch.js'
import type { TheoFetchOptions } from './theo-fetch.js'
import { HTTP_METHOD_LOWERCASE } from '../core/contracts/http-methods.js'

const HTTP_METHODS_SET = new Set(HTTP_METHOD_LOWERCASE)

/**
 * Keys that JavaScript runtime / inspectors / Promise resolution probe
 * unconditionally. Returning `undefined` for these keeps the Proxy from
 * pretending to be a thenable / iterable / serializable thing.
 */
const NON_INTERCEPT_KEYS = new Set([
  'then',
  'catch',
  'finally',
  'toJSON',
  'toString',
  'valueOf',
  'constructor',
  'prototype',
])

type FetchImpl = typeof theoFetch

interface CallOptions {
  params?: Record<string, string | number>
  query?: Record<string, unknown>
  body?: unknown
  signal?: AbortSignal
  headers?: HeadersInit
  // arbitrary RequestInit fields (mode, credentials, cache, etc.)
  [k: string]: unknown
}

function injectParams(path: string, params?: Record<string, string | number>): string {
  if (!params) {
    if (/:(?:\.\.\.)?[A-Za-z_]/.test(path)) {
      throw new TheoFetchError(0, {
        error: {
          code: 'MISSING_PARAM',
          message: `Route ${path} requires params but none were provided. Pass them via opts.params, e.g. client.posts.get({ params: { id: '123' } }).`,
        },
      })
    }
    return path
  }
  return path.replace(/:(?:\.\.\.)?([A-Za-z_][A-Za-z0-9_]*)/g, (_match, key: string) => {
    const value = params[key]
    if (value === undefined || value === null || value === '') {
      throw new TheoFetchError(0, {
        error: {
          code: 'MISSING_PARAM',
          message: `Param '${key}' is required for path '${path}' but was missing/empty.`,
        },
      })
    }
    return encodeURIComponent(String(value))
  })
}

interface ProxyContext {
  segments: string[]
  baseUrl: string
  fetchImpl: FetchImpl
}

function makeProxy(ctx: ProxyContext): unknown {
  const handler: ProxyHandler<() => void> = {
    get(_target, key) {
      if (typeof key !== 'string') return undefined
      if (NON_INTERCEPT_KEYS.has(key)) return undefined
      if (HTTP_METHODS_SET.has(key)) {
        return async (opts?: CallOptions) => {
          if (ctx.segments.length === 0) {
            throw new TheoFetchError(0, {
              error: {
                code: 'INVALID_PATH',
                message: `client.${key}() called without a route segment. Use client.<resource>.${key}(...) instead.`,
              },
            })
          }
          let finalPath = `${ctx.baseUrl}/${ctx.segments.join('/')}`
          if (opts?.params) {
            // Build a path with `:name` placeholders re-inserted from segments
            // whose name matches a key in opts.params (treat as dynamic).
            const segmentsWithDynamic = ctx.segments.map((seg) =>
              Object.prototype.hasOwnProperty.call(opts.params, seg) ? `:${seg}` : seg,
            )
            finalPath = injectParams(
              `${ctx.baseUrl}/${segmentsWithDynamic.join('/')}`,
              opts.params,
            )
          }
          const { params: _ignored, ...rest } = opts ?? {}
          const init = { method: key.toUpperCase(), ...rest } as unknown as TheoFetchOptions<unknown>
          return ctx.fetchImpl(finalPath, init)
        }
      }
      // Continue traversal — append segment to the path.
      return makeProxy({ ...ctx, segments: [...ctx.segments, key] })
    },
    apply() {
      return Promise.reject(
        new TheoFetchError(0, {
          error: {
            code: 'INVALID_CALL',
            message:
              'client(...) is not callable. Use client.<resource>.<method>(opts?) — e.g. client.posts.get().',
          },
        }),
      )
    },
  }
  return new Proxy(() => undefined, handler)
}

export interface CreateAppClientOptions {
  /** Base URL for the API. Defaults to `/api`. */
  baseUrl?: string
  /** Test-only fetch override. Production callers should not pass this. */
  fetchImpl?: FetchImpl
}

export function createAppClient<TAppClient = unknown>(
  baseUrlOrOptions?: string | CreateAppClientOptions,
  legacyFetchImpl?: FetchImpl,
): TAppClient {
  let baseUrl = '/api'
  let fetchImpl: FetchImpl = theoFetch
  if (typeof baseUrlOrOptions === 'string') {
    baseUrl = baseUrlOrOptions || '/api'
  } else if (baseUrlOrOptions && typeof baseUrlOrOptions === 'object') {
    if (baseUrlOrOptions.baseUrl) baseUrl = baseUrlOrOptions.baseUrl
    if (baseUrlOrOptions.fetchImpl) fetchImpl = baseUrlOrOptions.fetchImpl
  }
  // Legacy 2nd-arg fetchImpl overrides regardless of 1st-arg shape (test seam).
  if (legacyFetchImpl) fetchImpl = legacyFetchImpl
  // Strip trailing slash for predictable joining.
  if (baseUrl.length > 1 && baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1)
  return makeProxy({ segments: [], baseUrl, fetchImpl }) as TAppClient
}
