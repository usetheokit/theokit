import type { CustomTool } from '@theokit/sdk'
import { TheokitAgentError } from '@theokit/sdk/errors'
import { z } from 'zod'

import { ConfigurationError } from '../errors.js'

/** Reads the model's final answer as a schema-validated object, after a tool-using run. */
export interface ResultCapture<T> {
  /** Hand to `AgentBuilder.tool(...)`; the model ends the run by calling it. */
  tool: CustomTool
  /** The last valid submission. Throws {@link NoResultSubmittedError} when none was made. */
  result(): T
  submitted(): boolean
}

export class NoResultSubmittedError extends TheokitAgentError {
  constructor(toolName: string, rejected: number) {
    super(`No valid result: tool "${toolName}" got no valid submission (${rejected} rejected).`, {
      code: 'no_result_submitted',
      isRetryable: false,
    })
  }
}

/**
 * Builds a `submit_result` tool whose input schema is the caller's, and the state that remembers
 * the last valid submission. An invalid submission throws inside the handler, so the model sees a
 * tool error naming the zod issue paths and can correct itself.
 *
 * The tool cannot force the model to call it; the prompt must tell the model to.
 */
export function createResultCapture<T>(
  schema: z.ZodType<T>,
  opts: { name?: string; description?: string } = {},
): ResultCapture<T> {
  const name = opts.name ?? 'submit_result'
  const inputSchema = z.toJSONSchema(schema) as Record<string, unknown>
  if (inputSchema.type !== 'object') {
    throw new ConfigurationError(
      `createResultCapture: the schema for "${name}" must be an object schema; wrap it in z.object().`,
    )
  }
  let value: T | undefined
  let has = false
  let rejected = 0
  const tool: CustomTool = {
    name,
    description:
      opts.description ??
      'Submit your final result when your work is done. If it is rejected, fix it and call again.',
    inputSchema,
    handler: (input: unknown) => {
      const parsed = schema.safeParse(input)
      if (!parsed.success) {
        rejected++
        throw new Error(
          parsed.error.issues.map((i) => i.path.join('.') + ': ' + i.message).join('; '),
        )
      }
      value = parsed.data
      has = true
      return 'ok'
    },
  }
  return {
    tool,
    result() {
      if (!has) throw new NoResultSubmittedError(name, rejected)
      return value as T
    },
    submitted: () => has,
  }
}
