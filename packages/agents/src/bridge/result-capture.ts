import type { CustomTool } from '@theokit/sdk'
import { TheokitAgentError } from '@theokit/sdk/errors'
import { z } from 'zod'
import type { ZodType } from 'zod'

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
  override readonly name = 'NoResultSubmittedError'
  constructor(toolName: string, rejected: number) {
    super(
      `The model never submitted a valid result: tool "${toolName}" was not called with a valid input ` +
        `(${rejected} invalid submission${rejected === 1 ? '' : 's'} rejected).`,
      // The same run would end the same way on a retry only by chance; no retry policy is chosen here.
      { code: 'no_result_submitted', isRetryable: false },
    )
  }
}

function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((i) => `${i.path.length > 0 ? i.path.join('.') : '(root)'}: ${i.message}`)
    .join('; ')
}

/**
 * Builds a `submit_result` tool whose input schema is the caller's, and the state that remembers
 * the last valid submission. An invalid submission throws inside the handler, so the model sees a
 * tool error naming the zod issue paths and can correct itself.
 *
 * The tool cannot force the model to call it; the prompt must tell the model to.
 */
export function createResultCapture<T>(
  schema: ZodType<T>,
  opts: { name?: string; description?: string } = {},
): ResultCapture<T> {
  const name = opts.name ?? 'submit_result'
  const inputSchema = z.toJSONSchema(schema) as Record<string, unknown>
  if (inputSchema.type !== 'object') {
    throw new ConfigurationError(
      `createResultCapture: the schema for tool "${name}" must describe an object (JSON Schema ` +
        `type "object"), got ${JSON.stringify(inputSchema.type ?? null)}. Wrap it in z.object({...}).`,
    )
  }
  let value: T | undefined
  let has = false
  let rejected = 0
  const tool: CustomTool = {
    name,
    description:
      opts.description ??
      'Submit your final result. Call this once when your work is done; the input is your answer. ' +
        'If the input is rejected, fix it and call again.',
    inputSchema,
    handler: (input: unknown) => {
      const parsed = schema.safeParse(input)
      if (!parsed.success) {
        rejected++
        throw new Error(`Invalid result, not recorded. ${describeIssues(parsed.error)}`)
      }
      value = parsed.data
      has = true
      return 'Result recorded.'
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
