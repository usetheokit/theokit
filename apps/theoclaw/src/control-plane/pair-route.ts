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
  const { code, name, token } = (
    typeof parsed === 'object' && parsed !== null ? parsed : {}
  ) as Record<string, unknown>
  return typeof code === 'string' && typeof name === 'string' && typeof token === 'string'
    ? { code, name, token }
    : undefined
}

/**
 * The body as text, or undefined once it passes `MAX_MESSAGE_BYTES`. A declared length over the
 * limit is refused unread, and the stream is read with a running count so a body that lies about
 * its length (or has none) is dropped as soon as it passes the limit.
 */
async function readBounded(request: Request): Promise<string | undefined> {
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_MESSAGE_BYTES) return undefined
  if (request.body === null) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_MESSAGE_BYTES) {
      await reader.cancel()
      return undefined
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * `POST /control/pair` with `{ code, name, token }`: the device redeems an owner's setup code with a
 * token of its own. It answers `202 { id }` (waiting for the owner's approval; the token opens
 * nothing yet), `401` for an unknown, spent or expired code, `400` for a body or a name or token the
 * store refuses, `413` for a body over the size limit, `429` while too many requests wait, `405` for another method. No answer echoes the token.
 */
export async function pairRoute(devices: DevicePairing, request: Request): Promise<Response> {
  if (request.method !== 'POST')
    return new Response(null, { status: 405, headers: { Allow: 'POST' } })
  const text = await readBounded(request)
  if (text === undefined) return Response.json({ error: 'too_large' }, { status: 413 })
  const body = readPairBody(text)
  if (body === undefined) return Response.json({ error: 'bad_body' }, { status: 400 })
  const result = devices.request(body.code, body.name, body.token)
  if (result.ok) return Response.json({ id: result.id }, { status: 202 })
  const status =
    result.reason === 'unknown_or_expired' ? 401 : result.reason === 'too_many_pending' ? 429 : 400
  return Response.json({ error: result.reason }, { status })
}
