/**
 * `RateLimited(...)` — a rate limit a `@Controller` route can name (usetheokit/theokit#612).
 *
 * ## What this replaces
 *
 * `theokit/server/rate-limit` exported a complete limiter — `createRouteRateLimiterWeb`,
 * `InMemoryStore`, `deriveKey`, `matchRoutePattern` — and nothing a controller route could use. So
 * every app wrote the adapter, and this is the third instance of one pattern whose first two were
 * accepted and shipped:
 *
 * | Concern | Mechanism exported | Adapter |
 * |---|---|---|
 * | open route | `SetMetadata` + the key | `@Public()` (#574) |
 * | require a session | `UseGuards` | `Authenticated(sessions)` (#574) |
 * | limit a rate | `createRouteRateLimiterWeb` | **this** |
 *
 * ## The two things the hand-written adapter got wrong, and could not avoid
 *
 * **A guard could not answer 429.** `canActivate` returns a boolean, so a refused caller received
 * `403 Forbidden resource` and the `X-RateLimit-*` the limiter had just computed were discarded —
 * a guard owns no response to hang them on. "You are not allowed" and "you are allowed, later" read
 * identically, and a well-behaved client had nothing to back off on. That is fixed underneath this
 * file: an `HttpException` now carries headers, and all three dispatchers render them.
 *
 * **A `preHandler` plugin is the intuitive place and enforced nothing.** Plugin lifecycle hooks did
 * not fire for controller routes at all (#607, fixed), so six requests against `max: 3` all
 * returned 200 while reading exactly like protection. That defect is closed, and it is why an
 * adapter matters more here than convenience: the obvious alternative was silently inert.
 *
 * ## What it refuses to guess
 *
 * The framework's own `RouteRateLimitConfig` docblock warns that `trustProxy` left unset behind a
 * proxy puts every visitor in one bucket. On the Web path the hazard is sharper: a `Request` has no
 * socket address at all, so `keyBy: 'ip'` with nothing else declared would key every caller on one
 * placeholder — a limiter that refuses the whole internet after N requests and reads as protection
 * until it does. This constructor **throws** on that configuration rather than accepting it, which
 * is the docblock spent once instead of hoped for per adopter.
 *
 * ## How this relates to `@Throttle()`
 *
 * `@Throttle()` / `@SkipThrottle()` in `@theokit/http` store METADATA for the external
 * `@theokit/plugin-rate-limit` to read; they enforce nothing on their own, and an app without that
 * plugin gets a decorator that reads like a limit and is one only if something else is installed.
 * `RateLimited(...)` is the opposite arrangement: it carries the limiter with it, so the line that
 * declares the budget is the line that enforces it. Use `@Throttle()` when that plugin owns your
 * limits centrally; use this when the route owns them.
 *
 * ## What it deliberately does NOT do
 *
 * It does not attach `X-RateLimit-Limit` / `-Remaining` to ALLOWED responses. A guard runs before
 * the handler and has no response to decorate; adding one would mean a response-header channel
 * through the execution context, which exists in one of the three dispatchers and would therefore
 * work in one of three places. Stating that is worth more than a header that appears under
 * `TheoApp` and vanishes under `theokit start`. The refusal — where the numbers actually decide
 * client behaviour — carries them.
 */
import type { CanActivate, ExecutionContext } from '@theokit/http'
import { TooManyRequestsException } from '@theokit/http'

import { resolveClientIpFromRequest, type TrustProxy } from './client-ip.js'
import { createRouteRateLimiterWeb, type DeriveKeyRequestContext } from './rate-limit-per-route.js'
import type { RateLimitStore } from './rate-limit-store.js'
import type { RateLimitConfig } from './rate-limit.js'

/** Bucket identity strategies a Web `Request` can support. `keyBy`'s callback form is Node-shaped. */
export type RateLimitedKeyBy = 'ip' | 'session' | 'user'

export interface RateLimitedOptions extends RateLimitConfig {
  /**
   * What the budget is counted per. Default `'session'` — the one identity a `Request` carries on
   * its own, and the reason the default is not `'ip'` as it is on the Node path.
   */
  keyBy?: RateLimitedKeyBy
  /** Cookie read by `keyBy: 'session'`. Defaults to `theo_session`. */
  cookieName?: string
  /**
   * How many reverse proxies sit in front of the app, for `keyBy: 'ip'`.
   *
   * Required for `'ip'` unless {@link RateLimitedOptions.identify} supplies the address, because a
   * Web `Request` has no socket to fall back to. `x-forwarded-for` is client-writable, which is why
   * reading it is opt-in and counted from the right — see `client-ip.ts`.
   *
   * A request that arrives WITHOUT passing the declared proxies carries no trusted address, and
   * those share one bucket. That is the conservative direction — such a request should not exist
   * when the app is only reachable through the proxy — but it does mean a caller with direct access
   * to the port can exhaust the budget for other direct callers. Callers arriving through the proxy
   * are unaffected, since they key on their own address.
   */
  trustProxy?: TrustProxy
  /**
   * Resolve the caller yourself, when the runtime knows something the headers do not.
   *
   * Cloudflare Workers put the address in `cf-connecting-ip`; a Vercel or Deno adapter has its own
   * answer; `userId` can only come from the app's own auth. Whatever this returns wins over
   * `trustProxy`.
   */
  identify?: (request: Request) => DeriveKeyRequestContext | Promise<DeriveKeyRequestContext>
  /**
   * `'route'` (default) gives each path its own budget. `'shared'` pools every route this guard
   * instance is applied to into one — which is what an app capping three endpoints that bill a
   * third party per call actually wants: one budget for the money, not one per URL.
   */
  scope?: 'route' | 'shared'
  /** Shared store, for correlating budgets across guards. Defaults to a private `InMemoryStore`. */
  store?: RateLimitStore
  /** Message on the 429 body. Defaults to `'Rate limit exceeded'`. */
  message?: string
}

/**
 * Refuse a configuration that cannot identify a caller, at construction rather than at request time.
 *
 * A limiter that cannot tell callers apart does not fail — it succeeds at limiting everyone
 * together, and looks green while doing it. That is the failure mode this whole issue is about, so
 * it is refused where a developer is still reading the line they wrote.
 */
function assertCanBucket(options: RateLimitedOptions, keyBy: RateLimitedKeyBy): void {
  if (options.identify) return

  if (keyBy === 'ip' && (options.trustProxy === undefined || options.trustProxy === false)) {
    throw new Error(
      "RateLimited: keyBy: 'ip' needs a way to learn the caller's address — a Web Request has no " +
        'socket. Declare `trustProxy: <number of proxies in front of the app>` so the address is ' +
        'read from x-forwarded-for, or pass `identify: (request) => ({ clientIp })` for a runtime ' +
        "that knows it another way (e.g. Cloudflare's cf-connecting-ip). Without either, every " +
        'caller shares one bucket and the first few requests each window refuse everybody.',
    )
  }

  if (keyBy === 'user') {
    throw new Error(
      "RateLimited: keyBy: 'user' needs `identify: (request) => ({ userId })` — the framework " +
        'cannot read your app\'s notion of a user from a Request. Use keyBy: "session" to bucket ' +
        'on the session cookie instead.',
    )
  }
}

/**
 * Build a guard that caps how often a caller may reach the routes it is applied to.
 *
 * ```ts
 * import { RateLimited } from 'theokit/server/rate-limit'
 *
 * @Controller('api/voice')
 * export class VoiceController {
 *   @Post('stt')
 *   @UseGuards(Authenticated(sessions), RateLimited({ max: 20, windowMs: 60_000 }))
 *   transcribe() { ... }
 * }
 * ```
 *
 * Returns a CLASS, because `@UseGuards` takes constructors and instantiates one per request. The
 * limiter — and therefore the counter — lives in the closure, so it survives across requests and
 * works with or without DI. Two `RateLimited(...)` calls are two independent budgets, which is why
 * a shared budget is expressed by applying ONE guard to several routes rather than by configuring
 * the same numbers twice.
 *
 * A refused caller receives `429` with `Retry-After`, `X-RateLimit-Limit` and
 * `X-RateLimit-Remaining`.
 *
 * @param options the same `{ max, windowMs }` the limiter already accepts, plus how to bucket
 * @returns a guard class ready to pass to `@UseGuards`
 * @throws Error at construction when the configuration cannot identify a caller
 */
export function RateLimited(options: RateLimitedOptions): new () => CanActivate {
  const keyBy = options.keyBy ?? 'session'
  assertCanBucket(options, keyBy)

  const config: RateLimitConfig = { max: options.max, windowMs: options.windowMs }

  // `scope: 'route'` reaches the per-route bucket suffix the limiter already implements: a matched
  // pattern keys on the normalized path, an unmatched one falls to the shared `*default*` bucket.
  // Expressing scope through the existing mechanism keeps ONE implementation of the bucket key.
  const limiter = createRouteRateLimiterWeb(
    options.scope === 'shared'
      ? { default: config, keyBy, cookieName: options.cookieName, store: options.store }
      : {
          routePatterns: [[/^\//, config]],
          keyBy,
          cookieName: options.cookieName,
          store: options.store,
        },
  )

  const message = options.message ?? 'Rate limit exceeded'

  async function contextFor(request: Request): Promise<DeriveKeyRequestContext> {
    if (options.identify) return options.identify(request)
    const clientIp = resolveClientIpFromRequest(request, options.trustProxy ?? false)
    return clientIp === undefined ? {} : { clientIp }
  }

  return class RateLimitedGuard implements CanActivate {
    async canActivate(context: ExecutionContext): Promise<boolean> {
      const request = context.getRequest()
      const { limited, headers } = await limiter(request, await contextFor(request))

      if (limited) {
        // Thrown, not returned: `false` is the only thing a boolean can say, and it renders as 403
        // with the budget discarded. The exception carries both the status and the headers a client
        // needs to back off — see `@theokit/http`'s `HttpExceptionOptions.headers`.
        throw new TooManyRequestsException(message, { headers })
      }
      return true
    }
  }
}
