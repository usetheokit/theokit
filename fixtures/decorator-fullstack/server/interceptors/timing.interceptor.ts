import type { Interceptor } from '../../../../packages/http-decorators/src/bridge/interceptor-chain.js'

/**
 * TimingInterceptor — measures handler execution time.
 * Augments result with timing metadata.
 */
export class TimingInterceptor implements Interceptor {
  async intercept(
    _request: Request,
    next: () => Promise<unknown>,
  ): Promise<unknown> {
    const start = Date.now()
    const result = await next()
    const ms = Date.now() - start
    // Log timing (can't mutate Response headers in Web Standards — immutable)
    console.log(`[timing] ${ms}ms`)
    return result
  }
}
