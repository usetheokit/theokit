/**
 * Request Context — per-request state via AsyncLocalStorage.
 *
 * Inspired by Next.js workAsyncStorage pattern (app-render.tsx:3325).
 * Eliminates prop drilling — any code in the request path can access
 * the current request without receiving it as a parameter.
 *
 * Usage:
 *   import { getRequestContext } from '@theokit/http'
 *   const { request, pathname, method, params } = getRequestContext()
 *
 * The context is populated by TheoApp.handleRequest() and available
 * to guards, interceptors, filters, controllers, agents, and tools.
 */
import { AsyncLocalStorage } from 'node:async_hooks'

export interface TheoRequestContext {
  /** The raw Web Standard Request object. */
  request: Request
  /** URL pathname (e.g., '/api/tasks'). */
  pathname: string
  /** HTTP method (e.g., 'GET', 'POST'). */
  method: string
  /** Route params extracted from URL (e.g., { id: '42' }). */
  params: Record<string, string>
  /** Matched controller or agent class name (if resolved). */
  handler?: string
  /** Request start time (ms). */
  startedAt: number
}

const storage = new AsyncLocalStorage<TheoRequestContext>()

/**
 * Get the current request context.
 *
 * @throws Error if called outside a request (e.g., at module load time).
 *
 * @example
 * ```typescript
 * import { getRequestContext } from '@theokit/http'
 *
 * class AuthGuard {
 *   canActivate() {
 *     const { request } = getRequestContext()
 *     return request.headers.get('authorization') !== null
 *   }
 * }
 * ```
 */
export function getRequestContext(): TheoRequestContext {
  const ctx = storage.getStore()
  if (!ctx) {
    throw new Error(
      'getRequestContext() called outside a request. ' +
        'This function is only available inside TheoApp request handlers ' +
        '(controllers, guards, interceptors, filters, agents).',
    )
  }
  return ctx
}

/**
 * Try to get the current request context, or null if not in a request.
 * Useful for code that may run both inside and outside requests.
 */
export function tryGetRequestContext(): TheoRequestContext | null {
  return storage.getStore() ?? null
}

/**
 * Run a function within a request context.
 * Used internally by TheoApp — not part of public API.
 * @internal
 */
export async function runWithRequestContext<T>(
  ctx: TheoRequestContext,
  fn: () => T | Promise<T>,
): Promise<T> {
  return storage.run(ctx, fn)
}
