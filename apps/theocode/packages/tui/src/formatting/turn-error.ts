import { isTransientError, TheokitAgentError } from '@theokit/agents'

interface TurnErrorView {
  kind: 'transient' | 'fatal'
  message: string
  hint?: string
}

const NETWORK_SHAPE = /\b(ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EPIPE|socket hang up)\b/i
const STATUS_CODES = '408|429|500|502|503|504|529'
// A status number only counts in a status position: `HTTP 503`, `status: 429`, `statusCode=500`.
const STATUS_SHAPE = new RegExp(`\\b(?:HTTP|status(?:[ _-]?code)?)\\b[\\s:=/]*(?:${STATUS_CODES})\\b`, 'i')
const TRANSIENT_STATUSES = new Set(STATUS_CODES.split('|').map(Number))

function hasTransientStatus(err: Error): boolean {
  let current: unknown = err
  for (let i = 0; i < 8 && current instanceof Error; i += 1) {
    const e = current as { status?: unknown; statusCode?: unknown; cause?: unknown }
    for (const v of [e.status, e.statusCode]) {
      if (typeof v === 'number' && TRANSIENT_STATUSES.has(v)) return true
    }
    current = e.cause
  }
  return false
}

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
  const text = textWithCauses(err)
  if (NETWORK_SHAPE.test(text) || STATUS_SHAPE.test(text) || hasTransientStatus(err))
    return { kind: 'transient', message, hint: RETRY_HINT }
  return { kind: 'fatal', message }
}

export function formatTurnError(err: Error): string {
  const v = classifyTurnError(err)
  return v.hint === undefined ? v.message : `${v.message} — ${v.hint}`
}
