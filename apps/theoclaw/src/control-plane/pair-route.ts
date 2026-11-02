import type { DevicePairing } from './device-pairing.js'
import { MAX_MESSAGE_BYTES } from './limits.js'

/** The path a new device posts its setup code to (OC-91). */
export const PAIR_PATH = '/control/pair'

/**
 * `POST /control/pair` with `{ code, name, token }`: the device redeems an owner's setup code with a
 * token of its own. It answers `202 { id }` (waiting for the owner's approval; the token opens
 * nothing yet), `401` for an unknown, spent or expired code, `400` for a body or a name or token the
 * store refuses, `405` for another method. No answer echoes the token.
 */
export async function pairRoute(devices: DevicePairing, request: Request): Promise<Response> {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } })
  const text = await request.text()
  if (text.length > MAX_MESSAGE_BYTES) return Response.json({ error: 'too_large' }, { status: 400 })
  let body: { code?: unknown; name?: unknown; token?: unknown }
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null) return Response.json({ error: 'bad_body' }, { status: 400 })
    body = parsed as typeof body
  } catch {
    // Not JSON is a bad body, answered below; the parse error says no more than that.
    return Response.json({ error: 'bad_body' }, { status: 400 })
  }
  if (typeof body.code !== 'string' || typeof body.name !== 'string' || typeof body.token !== 'string') {
    return Response.json({ error: 'bad_body' }, { status: 400 })
  }
  const result = devices.request(body.code, body.name, body.token)
  if (result.ok) return Response.json({ id: result.id }, { status: 202 })
  return Response.json({ error: result.reason }, { status: result.reason === 'unknown_or_expired' ? 401 : 400 })
}
