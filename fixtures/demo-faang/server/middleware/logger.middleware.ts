import type { NestMiddleware } from '../../../../packages/http/src/bridge/middleware-consumer.js'

export class LoggerMiddleware implements NestMiddleware {
  use(request: Request, next: () => Promise<Response | null>): Promise<Response | null> {
    const url = new URL(request.url)
    console.log(`  ${new Date().toLocaleTimeString()} ${request.method} ${url.pathname}`)
    return next()
  }
}
