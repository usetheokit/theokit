import { Tool, type CustomTool } from '@theokit/sdk'
import { z } from 'zod'

import type { GoalRunnerDeps, JudgeResult } from './goal-runner.js'

/** What the working agent reports through the `update_goal` tool. */
export type GoalSignalStatus = 'complete' | 'blocked'

export interface GoalSignal {
  /** The update_goal tool; add it to the agent that works on the goal. */
  tool: CustomTool
  /** Pass as GoalRunnerDeps / RunUntilDeps: { judge: signal.judge }. */
  judge: NonNullable<GoalRunnerDeps>['judge']
  /** The status the tool recorded, or `undefined` before it was called. */
  status(): GoalSignalStatus | undefined
  /** Forget the recorded status, so the signal can serve the next goal. */
  reset(): void
}

const DEFAULT_DESCRIPTION =
  'Signal the state of the current goal. Call with status "complete" ONLY when the objective is fully ' +
  'achieved and no work remains; call with "blocked" ONLY after the same blocking condition has ' +
  'recurred and further progress is impossible. Do NOT use this to pause or manage budget; those are ' +
  'controlled by the user or the system.'

const inputSchema = z.object({
  status: z
    .enum(['complete', 'blocked'])
    .describe(
      'complete = objective achieved, no work remains; blocked = the same blocker recurred and progress is impossible.',
    ),
})

/**
 * A completion oracle the working agent drives itself: an `update_goal` tool plus a judge that reads
 * what the tool recorded. It saves the extra model call the LLM judge costs each round. The status
 * is kept until `reset()`, so reset (or create a new signal) before the next goal; use one signal
 * per concurrent goal.
 */
export function createGoalSignal(opts?: { toolName?: string; description?: string }): GoalSignal {
  let current: GoalSignalStatus | undefined
  const tool = Tool.create({
    name: opts?.toolName ?? 'update_goal',
    description: opts?.description ?? DEFAULT_DESCRIPTION,
    inputSchema,
    handler: ({ status }) => {
      current = status
      return Promise.resolve(JSON.stringify({ ok: true, status }))
    },
  })
  const judge = (): Promise<JudgeResult> => {
    if (current === undefined) {
      return Promise.resolve({
        verdict: 'continue',
        reason: 'no update_goal call yet',
        parseFailed: false,
      })
    }
    return Promise.resolve({
      verdict: current === 'blocked' ? 'blocked' : 'done',
      reason: `update_goal(${current})`,
      parseFailed: false,
    })
  }
  return {
    tool,
    judge,
    status: () => current,
    reset: () => {
      current = undefined
    },
  }
}
