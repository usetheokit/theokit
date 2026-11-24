import { coerceToKnownAgentRunErrorCode, isTransientError } from '@theokit/sdk/errors'
import type { KnownAgentRunErrorCode } from '@theokit/sdk/errors'

/** A thrown turn error reduced to a category, a retry verdict and a message. */
export interface TurnFailure {
  /** `'unknown'` when nothing typed matched. */
  code: KnownAgentRunErrorCode
  /** The code string as given, before coercion; absent when no code string was found. */
  rawCode?: string
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

const TOOL_IMAGE_HINT =
  'a tool returned an image and this provider carries tool results as text only; make the tool return text, or choose a provider that accepts image tool results'

/** Message probes, used for a next step only when no code gave one. Never used for `transient`. */
const MESSAGE_PROBES: readonly (readonly [string[], KnownAgentRunErrorCode | 'tool_image'])[] = [
  [['image content in tool results'], 'tool_image'],
  [['ratelimit', 'rate_limit', 'rate limit'], 'rate_limit'],
  [['unauthor', 'invalid_api_key', 'authenticationerror'], 'auth_failed'],
  [['econnrefused', 'enotfound', 'etimedout'], 'provider_unreachable'],
  [['quota'], 'quota_exceeded'],
]

/** Standalone HTTP status in the text, for a next step only (never for `transient`). */
const STATUS_PROBES: readonly (readonly [RegExp, KnownAgentRunErrorCode])[] = [
  [/\b401\b/, 'auth_failed'],
  [/\b429\b/, 'rate_limit'],
]

function messageHint(message: string, hints: TurnFailureHints): string | undefined {
  const m = message.toLowerCase()
  if (m.includes('context') && m.includes('length')) {
    return hints.context_too_long ?? DEFAULT_TURN_FAILURE_HINTS.context_too_long
  }
  for (const [needles, key] of MESSAGE_PROBES) {
    if (!needles.some((n) => m.includes(n))) continue
    return key === 'tool_image' ? TOOL_IMAGE_HINT : (hints[key] ?? DEFAULT_TURN_FAILURE_HINTS[key])
  }
  for (const [re, key] of STATUS_PROBES) {
    if (re.test(message)) return hints[key] ?? DEFAULT_TURN_FAILURE_HINTS[key]
  }
  return undefined
}

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined
}

function typedCode(node: unknown): { code: KnownAgentRunErrorCode; rawCode?: string } {
  let rawCode: string | undefined
  for (const raw of [field(field(node, 'metadata'), 'code'), field(node, 'code')]) {
    if (typeof raw !== 'string' || raw === '') continue
    const code = coerceToKnownAgentRunErrorCode(raw)
    if (code !== 'unknown') return { code, rawCode: raw }
    rawCode ??= raw
  }
  return { code: 'unknown', rawCode }
}

function nodeMessage(node: unknown): string {
  const raw = typeof node === 'string' ? node : field(node, 'message')
  return typeof raw === 'string' ? raw.trim() : ''
}

/** Turns any thrown value, with its cause chain, into a category and a retry verdict. */
export function classifyTurnFailure(err: unknown): TurnFailure {
  let code: KnownAgentRunErrorCode = 'unknown'
  let rawCode: string | undefined
  let transient = false
  const seen = new Set<unknown>()
  let node: unknown = err
  for (let depth = 0; depth <= MAX_CAUSE_DEPTH && node != null && !seen.has(node); depth++) {
    seen.add(node)
    if (code === 'unknown') {
      const typed = typedCode(node)
      code = typed.code
      if (typed.code !== 'unknown' || rawCode === undefined) rawCode = typed.rawCode ?? rawCode
    }
    if (!transient) {
      transient =
        isTransientError(node) ||
        [
          field(field(node, 'metadata'), 'statusCode'),
          field(node, 'status'),
          field(node, 'statusCode'),
        ].some((status) => typeof status === 'number' && TRANSIENT_STATUS.has(status))
    }
    node = field(node, 'cause')
  }
  const message = nodeMessage(err) || BLANK_MESSAGE
  return rawCode === undefined
    ? { code, transient, message }
    : { code, rawCode, transient, message }
}

/**
 * `"<message> [<code>]: <hint>"`, then `"after N attempts"` only when `attempts > 1`, then `suffix`.
 * An unknown code prints its `rawCode`. `probe` returns a hint that wins over the per-code hint.
 */
export function describeTurnFailure(
  failure: TurnFailure,
  opts: {
    attempts?: number
    hints?: TurnFailureHints
    probe?: (failure: TurnFailure) => string | undefined
    suffix?: string
  } = {},
): string {
  const hints = opts.hints ?? {}
  let text = failure.message || BLANK_MESSAGE
  const hint =
    opts.probe?.(failure) ??
    hints[failure.code] ??
    DEFAULT_TURN_FAILURE_HINTS[failure.code] ??
    messageHint(text, hints)
  const shown = failure.code !== 'unknown' ? failure.code : failure.rawCode
  if (shown) text += ` [${shown}]`
  if (hint) text += `: ${hint}`
  if (opts.attempts !== undefined && opts.attempts > 1) text += ` after ${opts.attempts} attempts`
  if (opts.suffix) text += ` ${opts.suffix}`
  return text
}
