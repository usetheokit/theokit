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
import type { IncomingMessage, ServerResponse } from 'node:http'

import { resolveOrNew, type DiContainer } from './di-resolve.js'

/**
 * Interceptor interface — classes decorated with @UseInterceptors must implement this.
 *
 * Includes `response` (EC-2) so interceptors can set headers (e.g., X-Response-Time).
 * `next()` wraps ONLY the handler call — body parsing happens before the chain.
 */
export interface Interceptor {
  intercept(
    request: IncomingMessage,
    response: ServerResponse,
    next: () => Promise<unknown>,
  ): Promise<unknown>
}

/**
 * Run the interceptor chain using the onion model.
 *
 * Outermost interceptor (first in array) wraps all inner ones.
 * The innermost layer is the actual handler function.
 *
 * If no interceptors, the handler runs directly (zero overhead).
 */
export async function runInterceptors(
  interceptors: Function[],
  handler: () => Promise<unknown>,
  req: IncomingMessage,
  res: ServerResponse,
  container?: DiContainer,
): Promise<unknown> {
  if (interceptors.length === 0) return handler()

  let chain = handler
  for (const Ctor of [...interceptors].reverse()) {
    const instance = resolveOrNew(Ctor, container) as Interceptor
    const nextFn = chain
    // Memoize: double-call of next() returns cached result (EC-5)
    let called = false
    let cachedResult: unknown
    const memoizedNext = async () => {
      if (called) return cachedResult
      called = true
      cachedResult = await nextFn()
      return cachedResult
    }
    chain = () => instance.intercept(req, res, memoizedNext)
  }
  return chain()
}
