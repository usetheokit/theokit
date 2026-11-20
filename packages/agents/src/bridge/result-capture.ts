import type { CustomTool } from '@theokit/sdk'
import { TheokitAgentError } from '@theokit/sdk/errors'
import { z } from 'zod'

import { ConfigurationError } from '../errors.js'

export interface ResultCapture<T> {
  /** The submit tool; add it to the agent that does the work. Named `submit_result` unless renamed. */
  tool: CustomTool
  /** The last valid submission. Throws `NoResultSubmittedError` when the model never submitted a valid one. */
  result(): T
  /** Whether a valid submission was recorded. */
  submitted(): boolean
}

/** Raised by `result()` when the model never submitted a value that passed the schema. */
export class NoResultSubmittedError extends TheokitAgentError {
  override readonly name = 'NoResultSubmittedError'
  readonly code = 'no_result_submitted'

  constructor(toolName: string, rejectedCount: number) {
    super(`No valid result via "${toolName}" (${rejectedCount} invalid rejected).`)
  }
}

/**
 * A tool the model ends its run with: its input schema is the caller's schema, and the handler
 * validates with zod. A rejected submission goes back to the model as a tool error so it can
 * correct itself. After the run, read the value with `result()`.
 *
 * The schema must describe an object (tool inputs are objects); anything else throws `ConfigurationError`.
 */
export function createResultCapture<T>(
  schema: z.ZodType<T>,
  opts?: { name?: string; description?: string },
): ResultCapture<T> {
  const name = opts?.name ?? 'submit_result'
  const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>
  if (jsonSchema.type !== 'object') {
    throw new ConfigurationError(`"${name}" schema must be an object schema.`)
  }

  let value: T | undefined
  let accepted = false
  let rejected = 0

  return {
    tool: {
      name,
      description: opts?.description ?? 'Submit your final result.',
      inputSchema: jsonSchema,
      handler(input: unknown) {
        const parsed = schema.safeParse(input)
        if (!parsed.success) {
          rejected += 1
          const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
          return Promise.reject(new Error(`Invalid input for ${name}: ${issues.join('; ')}`))
        }
        value = parsed.data
        accepted = true
        return Promise.resolve('ok')
      },
    },
    result() {
      if (!accepted) throw new NoResultSubmittedError(name, rejected)
      return value as T
    },
    submitted() {
      return accepted
    },
  }
}
