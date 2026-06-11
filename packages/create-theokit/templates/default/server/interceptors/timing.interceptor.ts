/**
 * TimingInterceptor — logs request duration.
 * Applied to both controllers and agents.
 */
import type { Interceptor } from '@theokit/http'

export class TimingInterceptor implements Interceptor {
  async intercept(_request: Request, next: () => Promise<unknown>): Promise<unknown> {
    const start = Date.now()
    const result = await next()
    console.log(`  ${Date.now() - start}ms`)
    return result
  }
}
