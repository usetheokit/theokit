/**
 * M31 Phase 3 — `route()`, the fluent builder that replaces `defineRoute({...})`.
 *
 * Pure type-state (mirrors `tool-builder.ts`). `.query/.body/.params` set Zod schemas whose
 * `z.infer<>` flows into the handler's `ctx`; `.handler()` is required before `.build()`. `.build()`
 * delegates to the internal {@link defineRoute} (an identity fn), emitting the identical
 * `RouteConfig` — the scan/execute path is UNCHANGED (identity-shape delegation, blueprint §2).
 *
 *   export const POST = route()
 *     .params(z.object({ id: z.string() }))
 *     .body(z.object({ text: z.string() }))
 *     .handler(({ params, body }) => save(params.id, body.text))
 *     .build()
 */
import type { z } from 'zod'

import type { RouteConfig } from '../../core/contracts/route-config.js'

import { defineRoute } from './define-route.js'

/** Compile-error carrier: `.build()` called before `.handler()`. */
interface MissingHandlerError {
  readonly __theokitError: 'a route needs .handler(fn) before .build()'
}

/**
 * The fluent route builder. `TQuery/TBody/TParams` track the input schemas (default `z.ZodUndefined`,
 * matching {@link RouteConfig}); `TResponse` tracks the handler return; `THandlerSet` gates `.build()`.
 */
export interface RouteBuilder<
  TQuery extends z.ZodType = z.ZodUndefined,
  TBody extends z.ZodType = z.ZodUndefined,
  TParams extends z.ZodType = z.ZodUndefined,
  TCtx = unknown,
  TResponse = unknown,
  THandlerSet extends boolean = false,
> {
  /** Set the URL search-params schema. Inferred into `ctx.query`. */
  query<S extends z.ZodType>(
    schema: S,
  ): RouteBuilder<S, TBody, TParams, TCtx, TResponse, THandlerSet>
  /** Set the request-body schema. Inferred into `ctx.body`. */
  body<S extends z.ZodType>(
    schema: S,
  ): RouteBuilder<TQuery, S, TParams, TCtx, TResponse, THandlerSet>
  /** Set the path-params schema. Inferred into `ctx.params`. */
  params<S extends z.ZodType>(
    schema: S,
  ): RouteBuilder<TQuery, TBody, S, TCtx, TResponse, THandlerSet>
  /** Runtime-only validation of the handler's plain-object return (500 on mismatch). Not inferred (YAGNI). */
  response(schema: z.ZodType): RouteBuilder<TQuery, TBody, TParams, TCtx, TResponse, THandlerSet>
  /** Override the HTTP status for a plain-object return (default 200; 204 for void). */
  status(code: number): RouteBuilder<TQuery, TBody, TParams, TCtx, TResponse, THandlerSet>
  /** Opt out of CSRF enforcement for this route (webhooks / OAuth callbacks). */
  csrf(disabled: false): RouteBuilder<TQuery, TBody, TParams, TCtx, TResponse, THandlerSet>
  /**
   * Set the handler. Its `ctx` infers `query/body/params` from the schemas set above. Required
   * before `.build()`.
   */
  handler<R>(
    fn: (ctx: {
      query: z.infer<TQuery>
      body: z.infer<TBody>
      params: z.infer<TParams>
      request: Request
      ctx: TCtx
    }) => R | Promise<R>,
  ): RouteBuilder<TQuery, TBody, TParams, TCtx, R, true>
  /**
   * Resolve to the `RouteConfig` — the SAME value `defineRoute({...})` returns. COMPILE ERROR when
   * `.handler()` was never called.
   */
  build(
    ...guard: THandlerSet extends true ? [] : [error: MissingHandlerError]
  ): RouteConfig<TQuery, TBody, TParams, TCtx, TResponse>
}

/**
 * Permissive internal shape — the runtime seam works with `z.ZodType` schemas (ctx fields typed
 * `unknown`); the precise per-schema types are carried to callers by the {@link RouteBuilder}
 * interface via the `as unknown as RouteBuilder` bridge. `defineRoute` is an identity fn.
 */
type AnyRouteConfig = RouteConfig<z.ZodType, z.ZodType, z.ZodType>

interface RouteSpecAccumulator {
  query?: z.ZodType
  body?: z.ZodType
  params?: z.ZodType
  response?: z.ZodType
  status?: number
  csrf?: false
  handler?: AnyRouteConfig['handler']
}

function makeRouteBuilder(spec: RouteSpecAccumulator): RouteBuilder {
  const runtime = {
    query: (schema: z.ZodType) => makeRouteBuilder({ ...spec, query: schema }),
    body: (schema: z.ZodType) => makeRouteBuilder({ ...spec, body: schema }),
    params: (schema: z.ZodType) => makeRouteBuilder({ ...spec, params: schema }),
    response: (schema: z.ZodType) => makeRouteBuilder({ ...spec, response: schema }),
    status: (code: number) => makeRouteBuilder({ ...spec, status: code }),
    csrf: (disabled: false) => makeRouteBuilder({ ...spec, csrf: disabled }),
    handler: (fn: AnyRouteConfig['handler']) => makeRouteBuilder({ ...spec, handler: fn }),
    build: (): AnyRouteConfig => {
      // Fail-fast for untyped (JS) callers — the type-state guard makes this unreachable from TS.
      if (spec.handler === undefined) {
        throw new Error('route(): call .handler(fn) before .build()')
      }
      const config: AnyRouteConfig = {
        ...(spec.query !== undefined ? { query: spec.query } : {}),
        ...(spec.body !== undefined ? { body: spec.body } : {}),
        ...(spec.params !== undefined ? { params: spec.params } : {}),
        ...(spec.response !== undefined ? { response: spec.response } : {}),
        ...(spec.status !== undefined ? { status: spec.status } : {}),
        ...(spec.csrf !== undefined ? { csrf: spec.csrf } : {}),
        handler: spec.handler,
      }
      return defineRoute(config)
    },
  }
  return runtime as unknown as RouteBuilder
}

/**
 * Start a fluent route definition. Chain `.query/.body/.params/.response/.status/.csrf` (all
 * optional), then `.handler()` (required) and `.build()` for the `RouteConfig`.
 */
export function route(): RouteBuilder {
  return makeRouteBuilder({})
}
