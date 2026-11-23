import type { MessageEvent } from '@theokit/gateway'
import { runAgentText } from '@theokit/gateway-agent'
import { createVoiceCallHandler } from '@theokit/gateway-sms'

import { maskSecrets } from '@theokit/gateway'
import { TheoClawConfigError } from '../control-plane/errors.js'
import { describeError } from '../control-plane/errors.js'
import type { SessionLease } from '../sessions/session-agents.js'

/** The variables that switch on answering inbound Twilio phone calls (OC-15). */
export const VOICE_CALL_TOKEN_VARIABLE = 'THEOCLAW_VOICE_CALL_TWILIO_AUTH_TOKEN'
export const VOICE_CALL_URL_VARIABLE = 'THEOCLAW_VOICE_CALL_PUBLIC_URL'
export const VOICE_CALL_ALLOWED_VARIABLE = 'THEOCLAW_VOICE_CALL_ALLOWED_NUMBERS'

/** The longest reply spoken, in characters; a longer one is cut. */
export const MAX_SPOKEN_CHARS = 1000

const E164 = /^\+[1-9]\d{6,14}$/
const GOODBYE = /^\s*(goodbye|good bye|bye|bye bye|hang up|that'?s all|that is all)\W*$/i

export interface VoiceCallSettings {
  readonly authToken: string
  /** The exact URL Twilio posts to (it signs this string), e.g. `https://host/webhooks/voice`. */
  readonly publicUrl: string
  /** E.164 numbers whose calls are answered. Caller ID is not authentication: it can be spoofed. */
  readonly allowedNumbers: ReadonlySet<string>
}

type Env = Readonly<Record<string, string | undefined>>

/**
 * The phone-call settings, or `undefined` while neither required variable is set. Setting one
 * without the other, a URL that is not http(s), or a number that is not E.164 throws.
 */
export function readVoiceCallSettings(env: Env): VoiceCallSettings | undefined {
  const authToken = (env[VOICE_CALL_TOKEN_VARIABLE] ?? '').trim()
  const publicUrl = (env[VOICE_CALL_URL_VARIABLE] ?? '').trim()
  const rawNumbers = (env[VOICE_CALL_ALLOWED_VARIABLE] ?? '').trim()
  if (authToken === '' && publicUrl === '') {
    if (rawNumbers === '') return undefined
    throw new TheoClawConfigError(`${VOICE_CALL_TOKEN_VARIABLE} is not set`, {
      variable: VOICE_CALL_TOKEN_VARIABLE,
    })
  }
  if (authToken === '')
    throw new TheoClawConfigError(`${VOICE_CALL_TOKEN_VARIABLE} is not set`, {
      variable: VOICE_CALL_TOKEN_VARIABLE,
    })
  if (publicUrl === '')
    throw new TheoClawConfigError(`${VOICE_CALL_URL_VARIABLE} is not set`, {
      variable: VOICE_CALL_URL_VARIABLE,
    })
  let protocol = ''
  try {
    protocol = new URL(publicUrl).protocol
  } catch {
    // reported below, without the value
  }
  if (protocol !== 'https:' && protocol !== 'http:') {
    throw new TheoClawConfigError(`${VOICE_CALL_URL_VARIABLE} is not an http(s) URL`, {
      variable: VOICE_CALL_URL_VARIABLE,
    })
  }
  const numbers = rawNumbers === '' ? [] : rawNumbers.split(',').map((number) => number.trim())
  numbers.forEach((number, index) => {
    if (!E164.test(number)) {
      throw new TheoClawConfigError(
        `${VOICE_CALL_ALLOWED_VARIABLE} entry ${index + 1} is not an E.164 number`,
        { variable: VOICE_CALL_ALLOWED_VARIABLE },
      )
    }
  })
  return { authToken, publicUrl, allowedNumbers: new Set(numbers) }
}

/** The secret values the settings hold, for the output and reply masks. */
export function voiceCallSecrets(env: Env): string[] {
  const token = (env[VOICE_CALL_TOKEN_VARIABLE] ?? '').trim()
  return token === '' ? [] : [token]
}

/** The spoken form of a reply: masked, whitespace folded, cut at `MAX_SPOKEN_CHARS`. */
function spoken(text: string, secrets: readonly string[]): string {
  const folded = maskSecrets(text, secrets).replace(/\s+/g, ' ').trim()
  return folded.length > MAX_SPOKEN_CHARS
    ? `${folded.slice(0, MAX_SPOKEN_CHARS - 1).trimEnd()}…`
    : folded
}

export interface VoiceCallRouteOptions {
  readonly settings: VoiceCallSettings
  /** The chat path's boundary: one session per call, so a follow-up sees earlier turns. */
  readonly withChatAgent: <R>(
    event: MessageEvent,
    work: (lease: SessionLease) => R | Promise<R>,
  ) => Promise<R>
  readonly write: (line: string) => void
  /** Values no reply may carry. */
  readonly secrets?: readonly string[]
}

/**
 * `POST /webhooks/voice`: Twilio's voice webhook, built on the framework's `createVoiceCallHandler`.
 * A bad or missing signature answers 401; a request without `CallSid` or `From` answers 400. A
 * caller outside the allowed numbers is hung up on before any turn runs. The first post greets and
 * listens; each post with `SpeechResult` runs one turn and speaks the reply; repeated silence, or
 * a goodbye, ends the call.
 */
export function createVoiceCallRoute(
  options: VoiceCallRouteOptions,
): (request: Request) => Promise<Response> {
  const { settings, withChatAgent, write } = options
  const secrets = options.secrets ?? []
  const handler = createVoiceCallHandler({
    authToken: settings.authToken,
    publicUrl: settings.publicUrl,
    allowed: [...settings.allowedNumbers],
    goodbye: GOODBYE,
    greeting: 'Hello, how can I help?',
    turn: async ({ from, callSid, text }) => {
      // A group channel, not a DM: the session is this call's alone, and no owner tool profile applies.
      const event = {
        id: `${callSid}-${Date.now()}`,
        platform: 'sms',
        sender: { id: from },
        channel: { id: `voice-call-${callSid}`, type: 'group' },
        text,
        receivedAt: Date.now(),
      } as unknown as MessageEvent
      let reply: string
      try {
        const outcome = await withChatAgent(event, async (lease) => {
          try {
            return await runAgentText(lease.agent, text)
          } finally {
            lease.release()
          }
        })
        if (!outcome.ok) write(`voice call: the turn failed (${outcome.failure})`)
        reply = outcome.ok ? spoken(outcome.text, secrets) : ''
      } catch (error) {
        write(`voice call: the turn failed (${describeError(error)})`)
        reply = ''
      }
      return reply === '' ? 'Sorry, I could not answer that.' : reply
    },
  })
  return async (request) => {
    const response = await handler(request)
    // The framework answers 403 to a bad signature; this route has always answered 401.
    return response.status === 403 ? new Response(null, { status: 401 }) : response
  }
}
