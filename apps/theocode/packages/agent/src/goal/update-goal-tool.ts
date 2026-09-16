import { Tool } from '@theokit/agents'
import { z } from 'zod'

export interface UpdateGoalSignal {
  status?: 'complete' | 'blocked'
}

const updateGoalSchema = z.object({
  status: z
    .enum(['complete', 'blocked'])
    .describe(
      'complete = objective achieved, no work remains; blocked = the same blocker recurred and progress is impossible.',
    ),
})

function makeUpdateGoalHandler(signal: UpdateGoalSignal) {
  return async ({ status }: { status: 'complete' | 'blocked' }): Promise<string> => {
    signal.status = status
    return JSON.stringify({ ok: true, status })
  }
}

export function createUpdateGoalTool(signal: UpdateGoalSignal) {
  return Tool.create({
    name: 'update_goal',
    description:
      'Signal the state of the current goal. Call with status "complete" ONLY when the objective is fully ' +
      'achieved and no work remains; call with "blocked" ONLY after the same blocking condition has ' +
      'recurred and further progress is impossible. Do NOT use this to pause or manage budget — those are ' +
      'controlled by the user/system.',
    inputSchema: updateGoalSchema,
    handler: makeUpdateGoalHandler(signal),
  })
}

export interface SignalVerdict {
  verdict: 'done' | 'continue' | 'skipped' | 'blocked'
  reason: string
  parseFailed: boolean
}

export function makeSignalJudge(signal: UpdateGoalSignal): () => Promise<SignalVerdict> {
  return async (): Promise<SignalVerdict> => {
    if (signal.status === undefined) {
      return { verdict: 'continue', reason: 'no update_goal call yet', parseFailed: false }
    }
    const verdict = signal.status === 'blocked' ? 'blocked' : 'done'
    return { verdict, reason: `update_goal(${signal.status})`, parseFailed: false }
  }
}
