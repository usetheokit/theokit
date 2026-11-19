/** The control socket's frames: what a client sends, what the server answers, and the parser. */
import type { AgentStreamEvent } from '../bridge/agent-stream-events.js'
import type { AgentTurnOutcome } from '../bridge/run-agent-turn.js'

/** Token usage of a finished turn, as `runAgentTurn` reports it. */
export type AgentTurnUsage = NonNullable<Extract<AgentTurnOutcome, { ok: true }>['usage']>

export type ControlClientFrame =
  | { type: 'chat'; message: string; session?: string }
  | { type: 'interrupt'; session: string }
  | { type: 'steer'; session: string; message: string }

export type ControlServerFrame =
  | { type: 'event'; event: AgentStreamEvent; session?: string }
  | { type: 'done'; session?: string; usage?: AgentTurnUsage }
  | { type: 'interrupted' | 'interrupt_ok' | 'steer_ok' | 'no_turn'; session: string }
  | { type: 'error'; code: string; session?: string }

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== ''
}

/** Parses one text frame; `undefined` when it is not valid JSON or not a known frame. */
export function parseControlFrame(raw: string): ControlClientFrame | undefined {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const frame = value as Record<string, unknown>
  switch (frame['type']) {
    case 'chat':
      if (!isNonEmptyString(frame['message'])) return undefined
      if (frame['session'] === undefined) return { type: 'chat', message: frame['message'] }
      if (!isNonEmptyString(frame['session'])) return undefined
      return { type: 'chat', message: frame['message'], session: frame['session'] }
    case 'interrupt':
      if (!isNonEmptyString(frame['session'])) return undefined
      return { type: 'interrupt', session: frame['session'] }
    case 'steer':
      if (!isNonEmptyString(frame['session']) || !isNonEmptyString(frame['message'])) {
        return undefined
      }
      return { type: 'steer', session: frame['session'], message: frame['message'] }
    default:
      return undefined
  }
}
