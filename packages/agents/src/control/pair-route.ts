import type { DevicePairing } from './device-pairing.js'

/** Request bodies over this many bytes are refused with 413. */
const MAX_BODY_BYTES = 65_536

const STATUS = {
  unknown_or_expired: 401,
  too_many_pending: 429,
  bad_credential: 400,
  bad_name: 400,
} as const

function readBody(text: string): { code: string; name: string; credential: string } | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  const fields = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Record<
    string,
    unknown
  >
  // `token` is the wire name TheoClaw clients send; `credential` is accepted as an alias.
  const { code, name } = fields
  const credential = fields.token ?? fields.credential
  return typeof code === 'string' && typeof name === 'string' && typeof credential === 'string'
    ? { code, name, credential }
    : undefined
}

/** The body as text, or undefined once it passes the limit (counted while reading). */
async function readBounded(request: Request): Promise<string | undefined> {
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return undefined
  if (request.body === null) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_BODY_BYTES) {
      await reader.cancel()
      return undefined
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * An HTTP handler for the device's side of pairing: `POST` with `{ code, name, token }` (`credential` is accepted
 * as an alias for `token`).
 * Answers `202 { id }` (waiting for the owner; the credential opens nothing yet), `401` for an
 * unknown, spent or expired code, `400` for a bad body, name or credential, `413` over 64 KiB,
 * `429` while too many requests wait, `405` for another method. No answer echoes the credential.
 */
export function pairRoute(pairing: DevicePairing): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== 'POST')
      return new Response(null, { status: 405, headers: { Allow: 'POST' } })
    const text = await readBounded(request)
    if (text === undefined) return Response.json({ error: 'too_large' }, { status: 413 })
    const body = readBody(text)
    if (body === undefined) return Response.json({ error: 'bad_body' }, { status: 400 })
    const result = pairing.request(body.code, body.name, body.credential)
    if (result.ok) return Response.json({ id: result.id }, { status: 202 })
    const status = STATUS[result.reason]
    return Response.json({ error: result.reason }, { status })
  }
}
