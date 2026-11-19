import type { CustomTool } from '@theokit/sdk'
import { TheokitAgentError } from '@theokit/sdk/errors'
import { z, type ZodType } from 'zod'

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

  constructor(
    readonly toolName: string,
    readonly rejectedCount: number,
  ) {
    super(
      `The model never submitted a valid result through the "${toolName}" tool` +
        ` (${rejectedCount} invalid submission${rejectedCount === 1 ? '' : 's'} rejected).`,
    )
  }
}

const DEFAULT_NAME = 'submit_result'
const DEFAULT_DESCRIPTION =
  'Submit the final result of your work. Call this exactly once when you are done, with the complete ' +
  'result as the input. If the input is rejected, read the error, fix it, and call again.'

/**
 * A tool the model ends its run with: its input schema is the caller's schema, and the handler
 * validates with zod. A rejected submission goes back to the model as a tool error so it can
 * correct itself. After the run, read the value with `result()`.
 *
 * The schema must describe an object (tool inputs are objects); anything else throws `ConfigurationError`.
 */
export function createResultCapture<T>(
  schema: ZodType<T>,
  opts?: { name?: string; description?: string },
): ResultCapture<T> {
  const name = opts?.name ?? DEFAULT_NAME
  const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>
  if (jsonSchema.type !== 'object') {
    throw new ConfigurationError(
      `createResultCapture: the schema for "${name}" must describe an object, got ${JSON.stringify(jsonSchema.type ?? 'a non-object schema')}.`,
    )
  }

  let value: T | undefined
  let accepted = false
  let rejected = 0

  const tool: CustomTool = {
    name,
    description: opts?.description ?? DEFAULT_DESCRIPTION,
    inputSchema: jsonSchema,
    handler: (input: unknown) => {
      const parsed = schema.safeParse(input)
      if (!parsed.success) {
        rejected += 1
        const issues = parsed.error.issues
          .map((i) => `${i.path.length > 0 ? i.path.join('.') : '(root)'}: ${i.message}`)
          .join('; ')
        return Promise.reject(
          new Error(`Invalid submission, fix and call ${name} again. ${issues}`),
        )
      }
      value = parsed.data
      accepted = true
      return Promise.resolve(JSON.stringify({ ok: true }))
    },
  }

  return {
    tool,
    result: () => {
      if (!accepted) throw new NoResultSubmittedError(name, rejected)
      return value as T
    },
    submitted: () => accepted,
  }
}
