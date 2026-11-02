import type { IncomingMessage, ServerResponse } from 'node:http'

import { type ReservedRoutes, serveReservedRoute } from '../server/define/health-route.js'

/**
 * Connect middleware for the dev server that answers `/__theo/health` and `/__theo/ready` the way
 * `theokit start` does, and passes every other request on. Under `theokit dev` both paths used to
 * reach the SPA fallback and return `index.html` with a 200 (usetheokit/theokit#1071).
 */
export function createReservedRouteMiddleware(
  routes: ReservedRoutes,
): (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => void {
  const serve = async (
    req: IncomingMessage,
    res: ServerResponse,
    next: (err?: unknown) => void,
  ): Promise<void> => {
    try {
      const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
      const reserved = await serveReservedRoute(pathname, routes)
      if (reserved === null) {
        next()
        return
      }
      res.statusCode = reserved.status
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(reserved.body))
    } catch (err) {
      // A readiness probe that throws is a 503 inside `serveReservedRoute`; reaching here is a fault
      // in the route itself, handed to Vite's error middleware rather than dropped.
      next(err)
    }
  }
  return (req, res, next) => {
    void serve(req, res, next)
  }
}
