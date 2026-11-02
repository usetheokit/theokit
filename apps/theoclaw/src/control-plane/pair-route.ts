import type { DevicePairing } from './device-pairing.js'
import { MAX_MESSAGE_BYTES } from './limits.js'

/** The path a new device posts its setup code to (OC-91). */
export const PAIR_PATH = '/control/pair'

interface PairBody {
  readonly code: string
  readonly name: string
  readonly token: string
}

/** The body as a `PairBody`, or undefined for anything else. Not JSON is a bad body, nothing more. */
function readPairBody(text: string): PairBody | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  const { code, name, token } = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Record<string, unknown>
  return typeof code === 'string' && typeof name === 'string' && typeof token === 'string' ? { code, name, token } : undefined
}

/**
 * `POST /control/pair` with `{ code, name, token }`: the device redeems an owner's setup code with a
 * token of its own. It answers `202 { id }` (waiting for the owner's approval; the token opens
 * nothing yet), `401` for an unknown, spent or expired code, `400` for a body or a name or token the
 * store refuses, `405` for another method. No answer echoes the token.
 */
export async function pairRoute(devices: DevicePairing, request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } })
  const text = await request.text()
  const body = text.length > MAX_MESSAGE_BYTES ? undefined : readPairBody(text)
  if (body === undefined) return Response.json({ error: 'bad_body' }, { status: 400 })
  const result = devices.request(body.code, body.name, body.token)
  if (result.ok) return Response.json({ id: result.id }, { status: 202 })
  return Response.json({ error: result.reason }, { status: result.reason === 'unknown_or_expired' ? 401 : 400 })
}
