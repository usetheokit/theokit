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
  const { type, message, session } = value as {
    type?: unknown
    message?: unknown
    session?: unknown
  }
  switch (type) {
    case 'chat':
      if (!isNonEmptyString(message)) return undefined
      // `null` reads as absent: a client that sends `session: null` means no session.
      if (session === undefined || session === null) return { type: 'chat', message }
      if (!isNonEmptyString(session)) return undefined
      return { type: 'chat', message, session }
    case 'interrupt':
      if (!isNonEmptyString(session)) return undefined
      return { type: 'interrupt', session }
    case 'steer':
      if (!isNonEmptyString(session) || !isNonEmptyString(message)) return undefined
      return { type: 'steer', session, message }
    default:
      return undefined
  }
}
