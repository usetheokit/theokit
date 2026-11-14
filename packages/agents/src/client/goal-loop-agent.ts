import type { GoalLoopAgent } from '@theokit/sdk'
import { TheokitAgentError } from '@theokit/sdk/errors'

import type { AgentClient, TurnSettled } from './agent-client.js'

/** A goal-loop turn that did not finish: the turn errored or was aborted. Carries the status and cause. */
export class GoalTurnFailedError extends TheokitAgentError {
  override readonly name = 'GoalTurnFailedError'
  readonly status: 'error' | 'aborted'
  constructor(status: 'error' | 'aborted', cause?: Error) {
    const detail = cause ? `: ${cause.message}` : ''
    super(`The goal turn ended with status '${status}'${detail}.`, {
      code: 'GOAL_TURN_FAILED',
      isRetryable: false,
      ...(cause ? { cause } : {}),
    })
    this.status = status
  }
}

/** Adapt a client to the SDK `GoalLoopAgent` contract; `wait()` rejects with `GoalTurnFailedError` on 'error' or 'aborted'. */
export function asGoalLoopAgent(client: AgentClient<string>): GoalLoopAgent {
  return {
    send(prompt: string) {
      const settled: Promise<TurnSettled> = client.sendAndWait(prompt)
      return Promise.resolve({
        wait: async () => {
          const turn = await settled
          if (turn.status !== 'done') throw new GoalTurnFailedError(turn.status, turn.error)
          return {
            ...(turn.text === undefined ? {} : { result: turn.text }),
            ...(turn.usage ? { usage: turn.usage } : {}),
          }
        },
      })
    },
  }
}
