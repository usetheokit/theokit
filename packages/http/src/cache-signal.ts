/**
 * Cache revalidation signals — runtime-agnostic intent layer.
 *
 * Controllers/agents call `revalidateTag('tasks')` or `revalidatePath('/api/tasks')`
 * to signal that cached data is stale. The signals are collected in the request
 * context and consumed by the cache engine (when present).
 *
 * In standalone @theokit/http (no full theokit framework), signals are stored
 * but not executed — no cache engine is wired. When theokit is present, the
 * cache engine reads signals from the request context after the handler completes.
 *
 * Inspired by Next.js cache-signal.ts + revalidateTag/revalidatePath API.
 */
import { tryGetRequestContext } from './request-context.js'

export interface RevalidationSignal {
  kind: 'tag' | 'path'
  value: string
  timestamp: number
}

/**
 * Signal that a cache tag should be revalidated.
 *
 * Safe to call from any request handler (controller, agent, action).
 * Signals are accumulated per-request and consumed by the cache engine.
 *
 * @example
 * ```typescript
 * import { revalidateTag } from '@theokit/http'
 *
 * @Post()
 * async createTask(@Body(schema) body) {
 *   const task = await db.tasks.create(body)
 *   revalidateTag('tasks')  // invalidate cached task lists
 *   return task
 * }
 * ```
 */
export function revalidateTag(tag: string): void {
  collectSignal({ kind: 'tag', value: tag, timestamp: Date.now() })
}

/**
 * Signal that a cached path should be revalidated.
 *
 * @example
 * ```typescript
 * import { revalidatePath } from '@theokit/http'
 *
 * @Delete(':id')
 * async removeTask(@Param('id') id: string) {
 *   await db.tasks.delete(id)
 *   revalidatePath('/api/tasks')
 * }
 * ```
 */
export function revalidatePath(path: string): void {
  collectSignal({ kind: 'path', value: path, timestamp: Date.now() })
}

/**
 * Get all revalidation signals collected during the current request.
 * Called by the cache engine after the handler completes.
 */
export function getRevalidationSignals(): RevalidationSignal[] {
  const ctx = tryGetRequestContext()
  if (!ctx) return []
  return (
    (ctx as unknown as { _revalidationSignals?: RevalidationSignal[] })._revalidationSignals ?? []
  )
}

// ── Internal ──

function collectSignal(signal: RevalidationSignal): void {
  const ctx = tryGetRequestContext()
  if (!ctx) {
    console.warn(
      '[theokit] revalidateTag/revalidatePath called outside a request context. Signal ignored.',
    )
    return
  }
  const extended = ctx as unknown as { _revalidationSignals?: RevalidationSignal[] }
  extended._revalidationSignals ??= []
  extended._revalidationSignals.push(signal)
}
