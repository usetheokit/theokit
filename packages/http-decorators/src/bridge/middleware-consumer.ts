/**
 * NestJS-style Middleware support for @theokit/http-decorators.
 *
 * Per D3: middleware runs BEFORE guards in the pipeline:
 *   middleware → guards → interceptors → handler
 *
 * Supports:
 *   - Class middleware: implements NestMiddleware { use(req, res, next) }
 *   - Functional middleware: (req, res, next) => void
 *   - Route filtering: forRoutes('path') + exclude('path')
 *
 * @see NestJS Middleware chapter
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

import { resolveOrNew, type DiContainer } from './di-resolve.js'

/**
 * NestJS-compatible middleware interface.
 * Class middleware must implement this interface.
 */
export interface NestMiddleware {
  use(
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void | Promise<void>,
  ): void | Promise<void>
}

/** Functional middleware — plain function shape. */
export type MiddlewareFn = (
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void | Promise<void>,
) => void | Promise<void>

/** Resolved middleware entry — produced by MiddlewareConsumer at config time. */
export interface ResolvedMiddleware {
  handler: MiddlewareFn
  routePatterns: string[]
  excludePatterns: string[]
}

/** Route info for forRoutes/exclude — string path or { path, method }. */
export type RouteInfo = string | { path: string; method?: string }

/** Builder returned by apply() — chains forRoutes/exclude. */
export interface MiddlewareConfigProxy {
  forRoutes(...routes: RouteInfo[]): MiddlewareConsumerImpl
  exclude(...routes: RouteInfo[]): MiddlewareConfigProxy
}

/**
 * MiddlewareConsumer — NestJS-compatible builder API.
 *
 * Usage:
 * ```ts
 * consumer
 *   .apply(LoggerMiddleware)
 *   .forRoutes('tasks')
 *
 * consumer
 *   .apply(cors)
 *   .exclude('health')
 *   .forRoutes('*')
 * ```
 */
export class MiddlewareConsumerImpl {
  private entries: ResolvedMiddleware[] = []
  private container?: DiContainer

  constructor(container?: DiContainer) {
    this.container = container
  }

  /** Apply one or more middleware (class or function). */
  apply(...middleware: (Function | MiddlewareFn)[]): MiddlewareConfigProxy {
    const resolved = middleware.map((m) => this.resolveMiddleware(m))
    const excludePatterns: string[] = []

    const proxy: MiddlewareConfigProxy = {
      exclude: (...routes: RouteInfo[]) => {
        for (const r of routes) {
          excludePatterns.push(typeof r === 'string' ? r : r.path)
        }
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

  /** Get all resolved middleware entries. */
  getEntries(): ResolvedMiddleware[] {
    return this.entries
  }

  /** Resolve a middleware class or function to a MiddlewareFn. */
  private resolveMiddleware(m: Function | MiddlewareFn): MiddlewareFn {
    // Functional middleware: plain function without a .use prototype method
    if (typeof m === 'function' && !m.prototype?.use) {
      return m as MiddlewareFn
    }
    // Class middleware: instantiate and bind .use()
    const instance = resolveOrNew(m, this.container) as NestMiddleware
    return (req, res, next) => {
      void instance.use(req, res, next)
    }
  }
}

/**
 * Check if a resolved middleware matches a given request path.
 * Returns true if the middleware should run for this path.
 */
export function middlewareMatchesPath(entry: ResolvedMiddleware, requestPath: string): boolean {
  // Check excludes first — excluded paths skip the middleware
  for (const pattern of entry.excludePatterns) {
    if (pathMatches(requestPath, pattern)) return false
  }
  // Check route patterns — at least one must match
  for (const pattern of entry.routePatterns) {
    if (pathMatches(requestPath, pattern)) return true
  }
  return false
}

/** Simple path matching: checks if requestPath starts with or equals the pattern. */
function pathMatches(requestPath: string, pattern: string): boolean {
  // Wildcard matches everything
  if (pattern === '*') return true
  // Normalize: ensure leading slash, strip trailing slash
  const normPath = ('/' + requestPath).replace(/\/+/g, '/').replace(/\/$/, '')
  const normPattern = ('/' + pattern).replace(/\/+/g, '/').replace(/\/$/, '')
  return normPath === normPattern || normPath.startsWith(normPattern + '/')
}

/**
 * Run all matching middleware for a given request path.
 * Returns true if any middleware ended the response (short-circuit).
 */
export async function runMiddleware(
  entries: ResolvedMiddleware[],
  req: IncomingMessage,
  res: ServerResponse,
  requestPath: string,
): Promise<boolean> {
  for (const entry of entries) {
    if (!middlewareMatchesPath(entry, requestPath)) continue
    const proceeded = await executeMiddleware(entry.handler, req, res)
    if (!proceeded) return true // middleware handled the response — short-circuit
  }
  return false
}

/**
 * Execute a single middleware function. Returns true if next() was called
 * (proceed to next middleware/guards), false if middleware handled the response.
 */
async function executeMiddleware(
  handler: MiddlewareFn,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    const onNext = () => {
      resolve(true)
    }
    try {
      const result = handler(req, res, onNext)
      if (result instanceof Promise) {
        result
          .then(() => {
            resolve(true)
          })
          .catch((err: unknown) => {
            reject(err instanceof Error ? err : new Error(String(err)))
          })
      }
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)))
    }
  })
}
