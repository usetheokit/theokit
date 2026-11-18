import { coerceToKnownAgentRunErrorCode, isTransientError } from '@theokit/sdk/errors'
import type { KnownAgentRunErrorCode } from '@theokit/sdk/errors'

/** A thrown turn error reduced to a category, a retry verdict and a message. */
export interface TurnFailure {
  /** `'unknown'` when nothing typed matched. */
  code: KnownAgentRunErrorCode
  /** From `isTransientError` and typed status fields only, never from message digits. */
  transient: boolean
  /** Never empty: `'the turn failed with no message'` when blank. */
  message: string
}

export type TurnFailureHints = Partial<Record<KnownAgentRunErrorCode, string>>

const MAX_CAUSE_DEPTH = 8
const BLANK_MESSAGE = 'the turn failed with no message'
const TRANSIENT_STATUS = new Set([408, 429, 500, 502, 503, 504, 529])

/** Neutral next-step wording, one entry per known code that has a next step. Callers override per code. */
export const DEFAULT_TURN_FAILURE_HINTS: Readonly<TurnFailureHints> = Object.freeze({
  rate_limit: 'the provider is rate limiting requests; wait a moment and try again',
  auth_failed: 'the provider refused the credential; check that it is valid and has access',
  provider_unreachable:
    'the provider could not be reached; check the network and the provider endpoint',
  network: 'a network error interrupted the request; check the connection and try again',
  timeout: 'the request timed out; try again',
  server_error: 'the provider reported an internal error; try again shortly',
  quota_exceeded: 'the quota or billing limit is exhausted; check the account plan and usage',
  invalid_model: 'the provider does not know this model; choose another model',
  model_unavailable: 'the model is unavailable right now; try again later or choose another model',
  context_too_long:
    'the conversation no longer fits the model context; compact it or start a new session',
  content_filtered: 'the provider filtered the content; rephrase the request',
  safety_blocked: 'the provider safety filter blocked the request; rephrase the request',
  invalid_request:
    'the provider rejected the request as malformed; check the request and its tool results',
})

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined
}

function typedCode(node: unknown): KnownAgentRunErrorCode {
  for (const raw of [field(field(node, 'metadata'), 'code'), field(node, 'code')]) {
    if (typeof raw !== 'string') continue
    const code = coerceToKnownAgentRunErrorCode(raw)
    if (code !== 'unknown') return code
  }
  return 'unknown'
}

function nodeMessage(node: unknown): string {
  const raw = typeof node === 'string' ? node : field(node, 'message')
  return typeof raw === 'string' ? raw.trim() : ''
}

/** Turns any thrown value, with its cause chain, into a category and a retry verdict. */
export function classifyTurnFailure(err: unknown): TurnFailure {
  let code: KnownAgentRunErrorCode = 'unknown'
  let transient = false
  const seen = new Set<unknown>()
  let node: unknown = err
  for (let depth = 0; depth <= MAX_CAUSE_DEPTH && node != null && !seen.has(node); depth++) {
    seen.add(node)
    if (code === 'unknown') code = typedCode(node)
    if (!transient) {
      const status = field(field(node, 'metadata'), 'statusCode')
      transient =
        isTransientError(node) || (typeof status === 'number' && TRANSIENT_STATUS.has(status))
    }
    node = field(node, 'cause')
  }
  return { code, transient, message: nodeMessage(err) || BLANK_MESSAGE }
}

/** `"<message> [<code>]: <hint>"`, then `"after N attempts"` only when `attempts > 1`. */
export function describeTurnFailure(
  failure: TurnFailure,
  opts: { attempts?: number; hints?: TurnFailureHints } = {},
): string {
  const hint = opts.hints?.[failure.code] ?? DEFAULT_TURN_FAILURE_HINTS[failure.code]
  let text = failure.message || BLANK_MESSAGE
  if (failure.code !== 'unknown') text += ` [${failure.code}]`
  if (hint) text += `: ${hint}`
  if (opts.attempts !== undefined && opts.attempts > 1) text += ` (after ${opts.attempts} attempts)`
  return text
}
