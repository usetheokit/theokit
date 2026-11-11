import { createHmac, timingSafeEqual } from 'node:crypto'

import type { MessageEvent } from '@theokit/gateway'

import { maskSecrets } from '../channels/channel-loop.js'
import { TheoClawConfigError } from '../control-plane/errors.js'
import { describeError } from '../control-plane/errors.js'
import type { SessionLease } from '../sessions/session-agents.js'
import { runText } from '../triggers/trigger-route.js'

/** The variables that switch on answering inbound Twilio phone calls (OC-15). */
export const VOICE_CALL_TOKEN_VARIABLE = 'THEOCLAW_VOICE_CALL_TWILIO_AUTH_TOKEN'
export const VOICE_CALL_URL_VARIABLE = 'THEOCLAW_VOICE_CALL_PUBLIC_URL'
export const VOICE_CALL_ALLOWED_VARIABLE = 'THEOCLAW_VOICE_CALL_ALLOWED_NUMBERS'

/** The longest reply spoken, in characters; a longer one is cut. */
export const MAX_SPOKEN_CHARS = 1000

/** How many calls keep their state at once; the oldest is forgotten first. */
const REMEMBERED_CALLS = 1000

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

function escapeXml(text: string): string {
  return text.replace(
    /[<>&"']/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c] as string,
  )
}

function response(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`
}

function say(text: string): string {
  return `<Say>${escapeXml(text)}</Say>`
}

function gather(action: string, prompt: string): string {
  return `<Gather input="speech" action="${escapeXml(action)}" method="POST" speechTimeout="auto">${say(prompt)}</Gather>`
}

/** TwiML that speaks `speech`, then listens. A silence falls through to the redirect, which posts again with no speech. */
export function listenTwiml(action: string, speech: string, prompt = ''): string {
  const inner = prompt === '' ? '' : say(prompt)
  return response(
    `${say(speech)}<Gather input="speech" action="${escapeXml(action)}" method="POST" speechTimeout="auto">${inner}</Gather><Redirect method="POST">${escapeXml(action)}</Redirect>`,
  )
}

/** TwiML that listens with `prompt`, then re-posts on silence. */
export function promptTwiml(action: string, prompt: string): string {
  return response(
    `${gather(action, prompt)}<Redirect method="POST">${escapeXml(action)}</Redirect>`,
  )
}

/** TwiML that speaks `speech` and ends the call. */
export function hangupTwiml(speech: string): string {
  return response(`${say(speech)}<Hangup/>`)
}

function xml(body: string): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/xml' } })
}

/** Twilio's signature: base64 HMAC-SHA1 of the URL followed by each sorted form key and value. */
export function twilioSignature(authToken: string, url: string, params: URLSearchParams): string {
  const entries = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const data = entries.reduce((text, [key, value]) => text + key + value, url)
  return createHmac('sha1', authToken).update(data).digest('base64')
}

function signatureMatches(expected: string, given: string | null): boolean {
  if (given === null) return false
  const a = Buffer.from(expected)
  const b = Buffer.from(given)
  return a.length === b.length && timingSafeEqual(a, b)
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
 * `POST /webhooks/voice`: Twilio's voice webhook. A bad or missing signature answers 401. A caller
 * outside the allowed numbers is refused and hung up on before any turn runs. Otherwise the first
 * post greets and listens; each post with `SpeechResult` runs one turn and speaks the reply; a
 * second silence in a row, or a goodbye, ends the call.
 */
export function createVoiceCallRoute(
  options: VoiceCallRouteOptions,
): (request: Request) => Promise<Response> {
  const { settings, withChatAgent, write } = options
  const secrets = options.secrets ?? []
  const action = settings.publicUrl
  /** Per call: the silences in a row. */
  const calls = new Map<string, number>()
  const remember = (callSid: string, silences: number): void => {
    calls.delete(callSid)
    calls.set(callSid, silences)
    if (calls.size > REMEMBERED_CALLS) calls.delete(calls.keys().next().value as string)
  }

  return async (request) => {
    const params = new URLSearchParams(await request.text())
    if (
      !signatureMatches(
        twilioSignature(settings.authToken, settings.publicUrl, params),
        request.headers.get('x-twilio-signature'),
      )
    ) {
      return new Response(null, { status: 401 })
    }
    const callSid = params.get('CallSid') ?? ''
    const from = (params.get('From') ?? '').trim()
    if (callSid === '') return new Response(null, { status: 400 })
    if (!settings.allowedNumbers.has(from)) {
      calls.delete(callSid)
      return xml(hangupTwiml('Sorry, this number is not allowed to use this service. Goodbye.'))
    }
    const heard = (params.get('SpeechResult') ?? '').trim()
    if (heard === '') {
      const silences = calls.get(callSid)
      if (silences === undefined) {
        remember(callSid, 0)
        return xml(promptTwiml(action, 'Hello, how can I help?'))
      }
      if (silences >= 1) {
        calls.delete(callSid)
        return xml(hangupTwiml('I did not hear anything. Goodbye.'))
      }
      remember(callSid, silences + 1)
      return xml(promptTwiml(action, 'Are you still there? Please say something.'))
    }
    if (GOODBYE.test(heard)) {
      calls.delete(callSid)
      return xml(hangupTwiml('Goodbye.'))
    }
    remember(callSid, 0)
    // A group channel, not a DM: the session is this call's alone, and no owner tool profile applies.
    const event = {
      id: `${callSid}-${Date.now()}`,
      platform: 'sms',
      sender: { id: from },
      channel: { id: `voice-call-${callSid}`, type: 'group' },
      text: heard,
      receivedAt: Date.now(),
    } as unknown as MessageEvent
    let reply: string
    try {
      const outcome = await withChatAgent(event, async (lease) => {
        try {
          return await runText(lease.agent, heard)
        } finally {
          lease.release()
        }
      })
      if (outcome.failure !== undefined) write(`voice call: the turn failed (${outcome.failure})`)
      reply = outcome.failure === undefined ? spoken(outcome.text, secrets) : ''
    } catch (error) {
      write(`voice call: the turn failed (${describeError(error)})`)
      reply = ''
    }
    return xml(listenTwiml(action, reply === '' ? 'Sorry, I could not answer that.' : reply))
  }
}
