import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * LoggerMiddleware — logs each incoming request.
 * NestJS-style class middleware with use(req, res, next).
 */
export class LoggerMiddleware {
  use(req: IncomingMessage, _res: ServerResponse, next: () => void) {
    const method = req.method ?? 'GET'
    const url = req.url ?? '/'
    console.log(`[LoggerMiddleware] ${method} ${url}`)
    next()
  }
}
