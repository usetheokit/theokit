import type { Interceptor } from '../../../../packages/http-decorators/src/bridge/interceptor-chain.js'

export class TimingInterceptor implements Interceptor {
  async intercept(_request: Request, next: () => Promise<unknown>): Promise<unknown> {
    const start = Date.now()
    const result = await next()
    console.log(`  ⏱  ${Date.now() - start}ms`)
    return result
  }
}
