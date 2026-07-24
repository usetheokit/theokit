/**
 * NestJS-style Middleware support — Web Standard Request/Response.
 *
 * Middleware runs BEFORE guards: middleware → guards → interceptors → handler
 *
 * Supports class middleware (NestMiddleware) and functional middleware.
 * Returns a Response to short-circuit, or null to continue.
 */
import { resolveOrNew, type DiContainer } from './di-resolve.js'

/** NestJS-compatible middleware interface — Web Standard. */
export interface NestMiddleware {
  use(
    request: Request,
    next: () => Promise<Response | null>,
  ): Response | null | Promise<Response | null>
}

/** Functional middleware. */
export type MiddlewareFn = (
  request: Request,
  next: () => Promise<Response | null>,
) => Response | null | Promise<Response | null>

export interface ResolvedMiddleware {
  handler: MiddlewareFn
  routePatterns: string[]
  excludePatterns: string[]
}

type RouteInfo = string | { path: string; method?: string }

export interface MiddlewareConfigProxy {
  forRoutes(...routes: RouteInfo[]): MiddlewareConsumerImpl
  exclude(...routes: RouteInfo[]): MiddlewareConfigProxy
}

export class MiddlewareConsumerImpl {
  private entries: ResolvedMiddleware[] = []
  private container?: DiContainer

  constructor(container?: DiContainer) {
    this.container = container
  }

  apply(...middleware: (Function | MiddlewareFn)[]): MiddlewareConfigProxy {
    const resolved = middleware.map((m) => this.resolveMiddleware(m))
    const excludePatterns: string[] = []

    const proxy: MiddlewareConfigProxy = {
      exclude: (...routes: RouteInfo[]) => {
        for (const r of routes) excludePatterns.push(typeof r === 'string' ? r : r.path)
        return proxy
      },
      forRoutes: (...routes: RouteInfo[]) => {
        const routePatterns = routes.map((r) => (typeof r === 'string' ? r : r.path))
        for (const handler of resolved) {
          this.entries.push({
            handler,
            routePatterns: [...routePatterns],
            excludePatterns: [...excludePatterns],
          })
        }
        return this
      },
    }
    return proxy
  }

  getEntries(): ResolvedMiddleware[] {
    return this.entries
  }

  private resolveMiddleware(m: Function | MiddlewareFn): MiddlewareFn {
    if (typeof m === 'function' && !m.prototype?.use) {
      return m as MiddlewareFn
    }
    const instance = resolveOrNew(m, this.container) as NestMiddleware
    return (request, next) => instance.use(request, next)
  }
}

export function middlewareMatchesPath(entry: ResolvedMiddleware, requestPath: string): boolean {
  for (const pattern of entry.excludePatterns) {
    if (pathMatches(requestPath, pattern)) return false
  }
  for (const pattern of entry.routePatterns) {
    if (pathMatches(requestPath, pattern)) return true
  }
  return false
}

function pathMatches(requestPath: string, pattern: string): boolean {
  if (pattern === '*') return true
  const normPath = ('/' + requestPath).replace(/\/+/g, '/').replace(/\/$/, '')
  const normPattern = ('/' + pattern).replace(/\/+/g, '/').replace(/\/$/, '')
  return normPath === normPattern || normPath.startsWith(normPattern + '/')
}

/**
 * Run all matching middleware. Returns a Response if any short-circuited, null otherwise.
 */
export async function runMiddleware(
  entries: ResolvedMiddleware[],
  request: Request,
  requestPath: string,
): Promise<Response | null> {
  for (const entry of entries) {
    if (!middlewareMatchesPath(entry, requestPath)) continue
    const response = await entry.handler(request, () => Promise.resolve(null))
    if (response) return response // short-circuit
  }
  return null
}
