import type { GoalRunOptions, TurnAgent } from '../agent-port.js'
import { describeError, TheoClawConfigError } from '../control-plane/errors.js'
import { requireModel } from '../control-plane/settings.js'

/** The variable that caps one goal's tokens (B-397 FR-008). */
export const GOAL_BUDGET_VARIABLE = 'THEOCLAW_GOAL_TOKEN_BUDGET'

/** The token budget of a goal when the variable is unset. */
const DEFAULT_TOKEN_BUDGET = 20_000

/** The one line a bare `/goal` answers with; nothing runs. */
export const GOAL_USAGE_REPLY = 'Usage: /goal <what you want done>'

/** The text after the status when the goal loop gave no final answer. */
const NO_FINAL_ANSWER = 'the goal ended with no final answer.'

const GOAL_COMMAND = /^\/goal(?:\s+([\s\S]*))?$/

/**
 * What every `/goal` runs with. The budget is read and checked at start; the model and its key
 * are resolved when a goal runs, as the chat agent's own are, so a start with no model still
 * refuses where it always did and nowhere else.
 */
export interface GoalSettings {
  readonly tokenBudget: number
  readonly judge: () => Pick<GoalRunOptions, 'agentModel' | 'judgeApiKey'>
}

/** How one `/goal` ended: the reply to send, and the error to rethrow after it, if the loop threw. */
export interface GoalOutcome {
  readonly reply: string
  readonly error?: unknown
}

/** `THEOCLAW_GOAL_TOKEN_BUDGET` (a positive integer, 20000 when unset) and the judge on the chat's model. */
export function readGoalSettings(env: Readonly<Record<string, string | undefined>>): GoalSettings {
  const raw = (env[GOAL_BUDGET_VARIABLE] ?? '').trim()
  const tokenBudget = raw === '' ? DEFAULT_TOKEN_BUDGET : Number(raw)
  if (raw !== '' && (!/^\d+$/.test(raw) || tokenBudget <= 0)) {
    throw new TheoClawConfigError(`${GOAL_BUDGET_VARIABLE} must be a positive whole number of tokens`, { variable: GOAL_BUDGET_VARIABLE })
  }
  return {
    tokenBudget,
    judge: () => {
      const { model, modelKey } = requireModel(env)
      return { agentModel: model, judgeApiKey: modelKey }
    },
  }
}

/**
 * The goal of a `/goal` message, matched on the whole trimmed text: `''` for a bare `/goal`, the
 * text after it otherwise, and undefined for anything else (`/goals x` is an ordinary message).
 */
export function goalOf(text: string): string | undefined {
  const match = GOAL_COMMAND.exec(text.trim())
  return match === null ? undefined : (match[1] ?? '').trim()
}

/** Run `goal` on the session's agent to its end and say how it ended, as `<status>: <final text>`. */
export async function runGoal(agent: TurnAgent, goal: string, settings: GoalSettings): Promise<GoalOutcome> {
  if (agent.runUntil === undefined) return { reply: 'failed: this agent cannot run a goal.' }
  try {
    const loop = agent.runUntil(goal, { tokenBudget: settings.tokenBudget, ...settings.judge() })
    let step = await loop.next()
    while (step.done !== true) step = await loop.next()
    return { reply: `${step.value.status}: ${step.value.finalResponse ?? NO_FINAL_ANSWER}` }
  } catch (error) {
    return { reply: `failed: ${describeError(error)}`, error }
  }
}
