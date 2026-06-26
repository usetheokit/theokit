/**
 * core/contracts/route-config.ts
 *
 * Canonical home for `RouteConfig<TQuery, TBody, TParams, TCtx, TResponse>` —
 * the contract shape consumed by `defineRoute()` (server) and
 * `defineCachedRoute()` (cache).
 *
 * Moved here in T2.2 of architecture-cleanup so `cache → core/contracts`
 * is the legal edge (replacing the prior `cache → server` violation).
 *
 * GAP-4 (plan v1.1): the 5-arity generic shape `<TQuery, TBody, TParams, TCtx, TResponse>`
 * MUST be preserved byte-by-byte. Type tests assert this in
 * `tests/unit/route-config-generic-arity.test.ts`.
 */

import type { z } from 'zod'

export interface RouteConfig<
  TQuery extends z.ZodType = z.ZodUndefined,
  TBody extends z.ZodType = z.ZodUndefined,
  TParams extends z.ZodType = z.ZodUndefined,
  TCtx = unknown,
  TResponse = unknown,
> {
  query?: TQuery
  body?: TBody
  params?: TParams
  status?: number
  /**
   * Optional Zod schema for the handler's plain-object return value. When
   * present, BOTH runtimes (Node `executeRoute` + Web `executeWebRequest`)
   * validate the handler's plain-object return against it BEFORE serializing.
   *
   * A mismatch is a SERVER fault (the handler violated its own declared
   * contract) → 500 `INTERNAL_SERVER_ERROR`, distinct from the 400 used for
   * input (`query`/`body`/`params`) validation failures.
   *
   * `Response`-instance returns (and `undefined`/`null` → 204) are NOT
   * validated. This is a plain optional field — runtime validation only; the
   * handler return type is NOT statically inferred from `response` (YAGNI).
   */
  response?: z.ZodType
  /**
   * Opt out of CSRF enforcement for this route. Use for endpoints that
   * legitimately receive third-party POSTs (Stripe webhooks, GitHub
   * webhooks, OAuth callbacks). Defaults to enforced per `config.security.csrf`.
   *
   * Setting `csrf: false` only disables the per-route check — it does NOT
   * disable the global mode setting for other routes.
   */
  csrf?: false
  handler: (ctx: {
    query: z.infer<TQuery>
    body: z.infer<TBody>
    params: z.infer<TParams>
    request: Request
    ctx: TCtx
  }) => TResponse | Promise<TResponse>
}
