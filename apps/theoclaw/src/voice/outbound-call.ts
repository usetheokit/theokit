import { UsageError } from '../cli-args.js'
import { maskSecrets } from '../channels/channel-loop.js'
import { TheoClawConfigError } from '../control-plane/errors.js'

/** `theoclaw call`: one outbound phone call through Twilio's REST API. */

const E164 = /^\+[1-9]\d{1,14}$/
const SID = /^[A-Za-z0-9]+$/

/** A Twilio request that failed; the message never carries the auth token. */
export class CallError extends Error {}

export interface PlaceCallOptions {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly to: string
  readonly message: string
  readonly fetch?: typeof fetch
}

export function escapeXml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function required(env: PlaceCallOptions['env'], name: string): string {
  const value = env[name]?.trim()
  if (!value) throw new TheoClawConfigError(`theoclaw call needs ${name}`)
  return value
}

/** Returns the call SID. Nothing is sent unless the number is E.164 and on the allow list. */
export async function placeCall(options: PlaceCallOptions): Promise<string> {
  const { env, to, message } = options
  if (!E164.test(to))
    throw new UsageError(`theoclaw call: ${to} is not an E.164 number (for example +15550100)`)
  if (message.trim() === '') throw new UsageError('theoclaw call: --message must not be empty')
  const allowed = (env.THEOCLAW_VOICE_CALL_ALLOWED_NUMBERS ?? '')
    .split(',')
    .map((n) => n.trim())
    .filter((n) => n !== '')
  if (allowed.length === 0)
    throw new UsageError(
      'theoclaw call: no destination is allowed; set THEOCLAW_VOICE_CALL_ALLOWED_NUMBERS to a comma-separated list of E.164 numbers',
    )
  if (!allowed.includes(to))
    throw new UsageError(`theoclaw call: ${to} is not in THEOCLAW_VOICE_CALL_ALLOWED_NUMBERS`)
  const sid = required(env, 'THEOCLAW_VOICE_CALL_TWILIO_ACCOUNT_SID')
  const token = required(env, 'THEOCLAW_VOICE_CALL_TWILIO_AUTH_TOKEN')
  const from = required(env, 'THEOCLAW_VOICE_CALL_FROM_NUMBER')
  if (!SID.test(sid))
    throw new TheoClawConfigError('THEOCLAW_VOICE_CALL_TWILIO_ACCOUNT_SID is malformed')

  const secrets = [token, Buffer.from(`${sid}:${token}`).toString('base64')]
  const body = new URLSearchParams({
    To: to,
    From: from,
    Twiml: `<Response><Say>${escapeXml(message)}</Say></Response>`,
  })
  try {
    const response = await (options.fetch ?? fetch)(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`,
      {
        method: 'POST',
        headers: {
          authorization: `Basic ${secrets[1]}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      },
    )
    const text = await response.text()
    let json: Record<string, unknown> = {}
    try {
      const parsed: unknown = JSON.parse(text)
      if (typeof parsed === 'object' && parsed !== null) json = parsed as Record<string, unknown>
    } catch {
      // not JSON: handled below
    }
    if (!response.ok) {
      const detail = typeof json.message === 'string' ? json.message : 'no message'
      throw new CallError(`Twilio refused the call (HTTP ${response.status}): ${detail}`)
    }
    if (typeof json.sid !== 'string' || json.sid === '')
      throw new CallError('Twilio response had no call SID')
    return json.sid
  } catch (error) {
    if (error instanceof CallError) throw new CallError(maskSecrets(error.message, secrets))
    const reason = error instanceof Error ? error.message : String(error)
    throw new CallError(`Twilio request failed: ${maskSecrets(reason, secrets)}`)
  }
}
