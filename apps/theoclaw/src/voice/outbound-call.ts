import { twiml } from '@theokit/gateway-sms'

import { UsageError } from '../cli-args.js'
import { maskSecrets } from '../channels/channel-loop.js'
import { TheoClawConfigError } from '../control-plane/errors.js'

const E164 = /^\+[1-9]\d{1,14}$/
const TIMEOUT_MS = 15_000
/** The builders open a document with this; the outbound call's inline TwiML has never carried it. */
const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>'

export interface PlaceCallInput {
  readonly env: NodeJS.ProcessEnv
  readonly to: string
  readonly message: string
  readonly fetch?: typeof fetch
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim()
  if (value === undefined || value === '') {
    throw new TheoClawConfigError(`${name} is not set`, { variable: name })
  }
  return value
}

/** Place one outbound call through Twilio's REST API and return its call SID. */
export async function placeCall(input: PlaceCallInput): Promise<string> {
  const { env, to, message } = input
  if (!E164.test(to)) throw new UsageError('theoclaw call: <number> must be E.164, such as +15550100')
  if (message.trim() === '') throw new UsageError('theoclaw call: --message must not be empty')
  const allowed = (env.THEOCLAW_VOICE_CALL_ALLOWED_NUMBERS ?? '')
    .split(',')
    .map((n) => n.trim())
    .filter((n) => n !== '')
  if (allowed.length === 0) {
    throw new UsageError(
      'theoclaw call: THEOCLAW_VOICE_CALL_ALLOWED_NUMBERS is not set; set it to a comma-separated list of E.164 numbers that may be called',
    )
  }
  if (!allowed.includes(to)) {
    throw new UsageError(`theoclaw call: ${to} is not in THEOCLAW_VOICE_CALL_ALLOWED_NUMBERS`)
  }
  const sid = required(env, 'THEOCLAW_VOICE_CALL_TWILIO_ACCOUNT_SID')
  const token = required(env, 'THEOCLAW_VOICE_CALL_TWILIO_AUTH_TOKEN')
  const from = required(env, 'THEOCLAW_VOICE_CALL_FROM_NUMBER')
  const secrets = [token, Buffer.from(`${sid}:${token}`).toString('base64')]
  const mask = (text: string): string => maskSecrets(text, secrets)

  const body = new URLSearchParams({
    To: to,
    From: from,
    Twiml: twiml.response(twiml.say(message)).replace(XML_DECLARATION, ''),
  })
  let response: Response
  try {
    response = await (input.fetch ?? fetch)(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Calls.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${secrets[1]}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    )
  } catch (error) {
    throw new Error(mask(`Twilio request failed: ${error instanceof Error ? error.message : String(error)}`))
  }
  let json: unknown
  try {
    json = await response.json()
  } catch {
    json = undefined
  }
  const record = typeof json === 'object' && json !== null ? (json as Record<string, unknown>) : {}
  if (!response.ok) {
    const detail = typeof record.message === 'string' ? record.message : 'no message'
    throw new Error(mask(`Twilio refused the call (HTTP ${response.status}): ${detail}`))
  }
  if (typeof record.sid !== 'string' || record.sid === '') {
    throw new Error('Twilio answered without a call SID')
  }
  return record.sid
}
