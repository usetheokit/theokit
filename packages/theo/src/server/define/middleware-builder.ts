/**
 * M31 Phase 3 — `middleware()`, the fluent builder that replaces `defineMiddleware(fn)`.
 *
 * A middleware IS a single function `(request, next) => Response`. The builder's `.handle()` sets it
 * (required); `.build()` delegates to the internal {@link defineMiddleware} (identity) and returns
 * the handler the runtime expects.
 *
 *   export default middleware()
 *     .handle(async (request, next) => {
 *       const res = await next(request)
 *       res.headers.set('x-mw', '1')
 *       return res
 *     })
 *     .build()
 */
import { defineMiddleware, type MiddlewareHandler } from './define-middleware.js'

/** Compile-error carrier: `.build()` called before `.handle()`. */
interface MissingHandleError {
  readonly __theokitError: 'middleware needs .handle(fn) before .build()'
}

/** The fluent middleware builder. `THandleSet` gates `.build()`. */
export interface MiddlewareBuilder<THandleSet extends boolean = false> {
  /** Set the `(request, next) => Response` handler. Required before `.build()`. */
  handle(fn: MiddlewareHandler): MiddlewareBuilder<true>
  /** Resolve to the `MiddlewareHandler`. COMPILE ERROR when `.handle()` was never called. */
  build(...guard: THandleSet extends true ? [] : [error: MissingHandleError]): MiddlewareHandler
}

function makeMiddlewareBuilder(fn: MiddlewareHandler | undefined): MiddlewareBuilder {
  const runtime = {
    handle: (handler: MiddlewareHandler) => makeMiddlewareBuilder(handler),
    build: (): MiddlewareHandler => {
      // Fail-fast for untyped (JS) callers — the type-state guard makes this unreachable from TS.
      if (fn === undefined) {
        throw new Error('middleware(): call .handle(fn) before .build()')
      }
      return defineMiddleware(fn)
    },
  }
  return runtime as unknown as MiddlewareBuilder
}

/** Start a fluent middleware definition. Chain `.handle()` (required), then `.build()`. */
export function middleware(): MiddlewareBuilder {
  return makeMiddlewareBuilder(undefined)
}
