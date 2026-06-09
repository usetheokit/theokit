import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Interceptor } from '../../../../packages/http-decorators/src/bridge/interceptor-chain.js'

/**
 * TimingInterceptor — measures handler execution time.
 * Adds X-Response-Time header to every response.
 */
export class TimingInterceptor implements Interceptor {
  async intercept(
    _req: IncomingMessage,
    res: ServerResponse,
    next: () => Promise<unknown>,
  ): Promise<unknown> {
    const start = Date.now()
    const result = await next()
    const ms = Date.now() - start
    res.setHeader('X-Response-Time', `${ms}ms`)
    return result
  }
}
