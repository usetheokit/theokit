/**
 * LoggerMiddleware — logs every incoming request.
 */
import type { NestMiddleware } from '@theokit/http-decorators'

export class LoggerMiddleware implements NestMiddleware {
  use(request: Request, next: () => Promise<Response | null>): Promise<Response | null> {
    const url = new URL(request.url)
    console.log(`  ${new Date().toLocaleTimeString()} ${request.method} ${url.pathname}`)
    return next()
  }
}
