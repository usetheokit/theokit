/**
 * Route Contract — type-level bridge between @Controller and TypedClient.
 *
 * The developer defines a contract object mapping routes to their types.
 * This object is the single source of truth for both server validation
 * and client type inference.
 *
 * @example
 * ```ts
 * // server/contracts.ts — shared between server and client
 * import { z } from 'zod'
 * import { contract } from '@theokit/http'
 *
 * export const zCreateTask = z.object({
 *   title: z.string().min(3),
 *   priority: z.enum(['low', 'medium', 'high']).default('medium'),
 * })
 *
 * export interface Task { id: number; title: string; priority: string; done: boolean }
 *
 * export const routes = contract({
 *   'GET /api/tasks':       { response: [] as Task[] },
 *   'GET /api/tasks/:id':   { response: {} as Task },
 *   'POST /api/tasks':      { body: zCreateTask, response: {} as Task },
 *   'PUT /api/tasks/:id':   { body: z.object({ done: z.boolean() }), response: {} as Task },
 *   'DELETE /api/tasks/:id': { response: undefined as void },
 * })
 * export type AppRoutes = typeof routes
 * ```
 *
 * The `contract()` function is identity at runtime (zero overhead) but
 * enforces the RouteMap type at the type level, enabling full inference.
 */
import type { RouteMap } from './typed-client.js'

/**
 * Identity function that enforces RouteMap type constraint.
 * Zero runtime overhead — exists only for type inference.
 */
export function contract<T extends RouteMap>(routes: T): T {
  return routes
}
