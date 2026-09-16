import { isTransientError, TheokitAgentError } from '@theokit/agents'

interface TurnErrorView {
  kind: 'transient' | 'fatal'
  message: string
  hint?: string
}

const TRANSIENT_SHAPE =
  /\b(408|429|500|502|503|504|529|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EPIPE|socket hang up)\b/i

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
  const message = err.message.trim() === '' ? 'the turn failed with no message' : err.message.trim()
  if (isTransientError(err)) return { kind: 'transient', message, hint: RETRY_HINT }
  if (err instanceof TheokitAgentError) return { kind: 'fatal', message }
  if (TRANSIENT_SHAPE.test(textWithCauses(err)))
    return { kind: 'transient', message, hint: RETRY_HINT }
  return { kind: 'fatal', message }
}

export function formatTurnError(err: Error): string {
  const v = classifyTurnError(err)
  return v.hint === undefined ? v.message : `${v.message} — ${v.hint}`
}
