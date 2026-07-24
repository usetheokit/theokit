/**
 * Server Action Handler — dispatch server actions via HTTP.
 *
 * Inspired by Next.js action-handler.ts (app-render/).
 * Detects actions via X-Theo-Action header, validates input with Zod,
 * dispatches to the registered handler, and returns JSON result.
 *
 * If no action header is present, returns null so the request
 * falls through to the controller pipeline.
 */
import type { z } from 'zod'

/** Definition of a single server action. */
interface ActionDefinition<T extends z.ZodType = z.ZodType> {
  /** Unique action identifier. */
  id: string
  /** Zod schema for input validation. */
  input: T
  /** Handler that executes the action. */
  handler: (input: z.infer<T>) => Promise<unknown>
}

/** Registry that stores and retrieves action definitions by id. */
interface ActionRegistry {
  register<T extends z.ZodType>(action: ActionDefinition<T>): void
  get(id: string): ActionDefinition | undefined
}

/**
 * Create a new action registry.
 *
 * @example
 * ```typescript
 * const registry = createActionRegistry()
 * registry.register({ id: 'createUser', input: UserSchema, handler: createUser })
 * ```
 */
export function createActionRegistry(): ActionRegistry {
  const actions = new Map<string, ActionDefinition>()

  return {
    register<T extends z.ZodType>(action: ActionDefinition<T>): void {
      // Erase the input type at the storage boundary. The handler is only ever
      // invoked with data already validated by `action.input` (see handleAction
      // below), so narrowing the validated payload back to `z.infer<T>` is sound.
      actions.set(action.id, {
        id: action.id,
        input: action.input,
        handler: (input: unknown) => action.handler(input as z.infer<T>),
      })
    },
    get(id: string): ActionDefinition | undefined {
      return actions.get(id)
    },
  }
}

const ACTION_HEADER = 'x-theo-action'

/**
 * Handle an incoming request as a server action.
 *
 * Returns a Response with JSON result/error, or null if the request
 * does not contain the X-Theo-Action header (fall through to controller).
 *
 * Error responses:
 * - 404: action not found in registry
 * - 400: malformed JSON body or Zod validation failure
 * - 500: handler threw an unexpected error
 */
export async function handleAction(
  registry: ActionRegistry,
  request: Request,
): Promise<Response | null> {
  const actionId = request.headers.get(ACTION_HEADER)
  if (!actionId) {
    return null
  }

  const action = registry.get(actionId)
  if (!action) {
    return Response.json({ error: 'Action not found', actionId }, { status: 404 })
  }

  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return Response.json({ error: 'Malformed JSON body' }, { status: 400 })
  }

  const parsed = action.input.safeParse(rawBody)
  if (!parsed.success) {
    return Response.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 400 },
    )
  }

  try {
    const result = await action.handler(parsed.data)
    return Response.json({ result })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error'
    return Response.json({ error: message }, { status: 500 })
  }
}
