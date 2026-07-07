/**
 * M26 (ADR-0041) — `createWorkflowTool`: wrap an SDK `Workflow` as a `CustomTool`.
 *
 * THIN adapter. `packages/workflows/` stays G13-forbidden — the workflow ENGINE is the SDK's
 * (`Workflow.create(...).run(input)`). This exposes an already-built `Workflow` to an agent as one
 * callable tool: it validates the tool input, delegates to `workflow.run(input)`, and shapes the
 * result for the model. It calls no LLM, dispatches no tool, and runs no orchestration of its own —
 * the SDK owns all of that (sdk-runtime.md / G2).
 */
import { z } from 'zod'

import { defineAgentTool, type CustomTool } from '../define/define-agent-tool.js'

/**
 * Structural stand-in for the SDK `Workflow` (the adapter never imports the SDK type — keeps the
 * SDK an optional peer). Any object with a `run(input)` resolving to `{ status, output }` matches.
 */
export interface WorkflowLike {
  run(input: unknown): Promise<{ status: string; output: unknown; runId?: string }>
}

/** Config for {@link createWorkflowTool}. `inputSchema` defaults to an open object. */
export interface WorkflowToolConfig {
  /** Tool name surfaced to the LLM. */
  name: string
  /** Tool description surfaced to the LLM. */
  description: string
  /** Zod schema for the workflow input (defaults to `z.object({}).passthrough()`). */
  inputSchema?: z.ZodType
}

/** Statuses `Workflow.run` reports as a non-success terminal state. */
const FAILURE_STATUSES = new Set(['failed', 'error', 'cancelled', 'canceled'])

/**
 * Wrap an SDK `Workflow` as a {@link CustomTool}. Fails fast if `workflow` does not expose a
 * `run()` method (the SDK Workflow contract), so a mis-wired call is caught at definition time, not
 * at the first invocation (error-handling.md).
 */
export function createWorkflowTool(workflow: WorkflowLike, config: WorkflowToolConfig): CustomTool {
  const runFn = (workflow as { run?: unknown } | null | undefined)?.run
  if (typeof runFn !== 'function') {
    throw new Error(
      'createWorkflowTool: the SDK does not expose a Workflow (expected an object with a run() method). ' +
        'Pass a `Workflow.create(...).…build()` instance from @theokit/sdk.',
    )
  }
  // Open object by default so arbitrary workflow inputs pass through un-stripped.
  const inputSchema = config.inputSchema ?? z.looseObject({})

  return defineAgentTool({
    name: config.name,
    description: config.description,
    inputSchema: inputSchema as z.ZodObject<z.ZodRawShape>,
    handler: async (input: unknown): Promise<string> => {
      const run = await workflow.run(input)
      if (FAILURE_STATUSES.has(run.status)) {
        throw new Error(
          `createWorkflowTool(${JSON.stringify(config.name)}): workflow run ${
            run.runId ? `'${run.runId}' ` : ''
          }failed with status '${run.status}'.`,
        )
      }
      return typeof run.output === 'string' ? run.output : JSON.stringify(run.output)
    },
  })
}
