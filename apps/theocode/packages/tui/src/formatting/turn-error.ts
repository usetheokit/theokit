import { TheokitAgentError } from '@theokit/agents'
import { classifyTurnFailure } from '@theokit/agents/errors'

interface TurnErrorView {
  kind: 'transient' | 'fatal'
  message: string
  hint?: string
}

const NETWORK_SHAPE =
  /\b(ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EPIPE|socket hang up)\b/i
// A bare number is not a status: only one in a status position counts.
const STATUS_SHAPE = /\b(?:HTTP|status(?:\s*code)?)\s*[:=]?\s*(?:408|429|500|502|503|504|529)\b/i

function textWithCauses(err: Error): string {
  const parts: string[] = []
  let current: unknown = err
  for (let i = 0; i < 8 && current instanceof Error; i += 1) {
    parts.push(current.message)
    current = (current as { cause?: unknown }).cause
  }
  if (typeof current === 'string') parts.push(current)
  return parts.join(' | ')
}

const RETRY_HINT = '/retry resends the last message'

function classifyTurnError(err: Error): TurnErrorView {
  const { transient, message } = classifyTurnFailure(err)
  if (transient) return { kind: 'transient', message, hint: RETRY_HINT }
  if (err instanceof TheokitAgentError) return { kind: 'fatal', message }
  // The framework classifier ignores message text by design; TheoCode keeps this fallback for
  // untyped errors from providers that only put the status or socket code in the message.
  const text = textWithCauses(err)
  if (NETWORK_SHAPE.test(text) || STATUS_SHAPE.test(text))
    return { kind: 'transient', message, hint: RETRY_HINT }
  return { kind: 'fatal', message }
}

export function formatTurnError(err: Error): string {
  const v = classifyTurnError(err)
  return v.hint === undefined ? v.message : `${v.message} — ${v.hint}`
}
