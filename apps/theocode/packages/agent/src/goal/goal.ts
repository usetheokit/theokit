import { GoalRunner, type GoalLoopAgent, TheokitAgentError } from '@theokit/agents'
import type { GoalEvent, GoalOptions, GoalResult, GoalRunnerDeps } from '@theokit/agents'

import { routeToCredential } from '../auth/index.js'

function defaultGoalLoop(
  agent: GoalLoopAgent,
  goal: string,
  options?: GoalOptions,
  deps?: GoalRunnerDeps,
): AsyncGenerator<GoalEvent, GoalResult, void> {
  return new GoalRunner(agent).run(goal, options, deps)
}

export type GoalCapableAgent = GoalLoopAgent

function formatGoalEvent(event: GoalEvent): string {
  switch (event.type) {
    case 'turn_start':
      return `▶ turn ${event.turn}`
    case 'judge_verdict':
      return `⚖ judge: ${event.verdict}${event.reason ? ` — ${event.reason}` : ''}`
    case 'status_change':
      return `● ${event.status}${event.reason ? ` — ${event.reason}` : ''}`
    case 'agent_response':
    case 'continuation':
      return ''
    default:
      // Events arrive at RUNTIME from `@theokit/agents`. The cases above are exhaustive over the
      // union this repository compiled against, so `tsc` is satisfied without this branch — but the
      // moment the SDK adds a variant, the switch returned `undefined` and the caller's
      // `line.length` threw a raw TypeError, killing the goal run mid-flight on a message that says
      // nothing about goals. An unrecognised event is forward compatibility, not an exceptional
      // condition (`rules/error-handling.md` § 2): render nothing, keep driving.
      return ''
  }
}

export interface GoalCredential {
  kind: 'api' | 'oauth'
  provider: string
  apiKey: string
}

export function routeGoalModel(
  cred: Pick<GoalCredential, 'kind' | 'provider'>,
  configModel: string,
): string {
  return routeToCredential(cred as Parameters<typeof routeToCredential>[0], configModel)
}

export const GOAL_DEFAULTS = { maxTurns: 20, tokenBudget: 150_000 } as const

export class GoalRunUnsupportedError extends TheokitAgentError {
  override readonly name = 'GoalRunUnsupportedError'
}

export interface RunGoalDeps {
  onLine: (line: string) => void
  onEvent?: (event: GoalEvent) => void
  loop?: typeof defaultGoalLoop
  depsOverride?: GoalRunnerDeps
}

export async function runGoal(
  agent: GoalCapableAgent,
  goal: string,
  options: GoalOptions,
  deps: RunGoalDeps,
): Promise<GoalResult> {
  if (agent === null || typeof agent !== 'object' || typeof agent.send !== 'function') {
    throw new GoalRunUnsupportedError('goal: this agent has no send() surface to drive the loop')
  }
  const gen = (deps.loop ?? defaultGoalLoop)(agent, goal, options, deps.depsOverride)
  while (true) {
    const step = await gen.next()
    if (step.done === true) return step.value
    deps.onEvent?.(step.value)
    const line = formatGoalEvent(step.value)
    if (line.length > 0) deps.onLine(line)
  }
}
