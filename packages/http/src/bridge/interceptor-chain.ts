/**
 * Interceptor execution engine — onion-model chain runner.
 *
 * Per Pattern D3: "@UseInterceptors both translate to defineMiddleware wraps".
 * Interceptors wrap the handler call (NOT body parsing — EC-1) and can
 * transform the response or short-circuit by not calling next().
 *
 * Execution order follows NestJS convention:
 *   middleware → guards → interceptors → handler
 * Interceptor composition: class-level FIRST, then method-level (EC-9).
 */
import { resolveOrNew, type DiContainer } from './di-resolve.js'

/**
 * Interceptor interface — Web Standard Request.
 * `next()` wraps ONLY the handler call — body parsing happens before.
 */
export interface Interceptor {
  intercept(
    request: Request,
    next: () => Promise<unknown>,
  ): Promise<unknown>
}

/**
 * Run the interceptor chain using the onion model.
 * Outermost interceptor (first in array) wraps all inner ones.
 */
export async function runInterceptors(
  interceptors: Function[],
  handler: () => Promise<unknown>,
  request: Request,
  container?: DiContainer,
): Promise<unknown> {
  if (interceptors.length === 0) return handler()

  let chain = handler
  for (const Ctor of [...interceptors].reverse()) {
    const instance = resolveOrNew(Ctor, container) as Interceptor
    const nextFn = chain
    let called = false
    let cachedResult: unknown
    const memoizedNext = async () => {
      if (called) return cachedResult
      called = true
      cachedResult = await nextFn()
      return cachedResult
    }
    chain = () => instance.intercept(request, memoizedNext)
  }
  return chain()
}
