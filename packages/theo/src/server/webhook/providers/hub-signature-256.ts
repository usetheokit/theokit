/**
 * `X-Hub-Signature-256` — HMAC-SHA256 over the RAW body, hex, prefixed `sha256=`.
 *
 * One implementation for the two platforms that use it. GitHub and Meta (WhatsApp, Instagram,
 * Messenger) send the same header under the same construction, because both descend from the PubSubHubbub
 * convention the name comes from. Writing it twice would duplicate not a shape but a security
 * decision — the constant-time compare, the rejection of a malformed hex, the per-secret loop that
 * makes rotation survivable — and the second copy is the one that drifts.
 *
 * Web Crypto rather than `node:crypto`, per ADR-0028: the same code has to run on Workers, Bun and
 * Deno. The comparison is `timingSafeEqual` over the raw signature BYTES, never the hex strings —
 * a `===` on hex short-circuits at the first differing character and leaks where it differed.
 *
 * There is no timestamp in this scheme and therefore no replay window. Replay protection is the
 * handler's business (make it idempotent); claiming it here would be a promise this code cannot
 * keep.
 */
import { timingSafeEqual } from '../timing-safe-equal.js'
import type { VerifyFn, VerifyResult } from '../webhook-types.js'

const HEADER = 'x-hub-signature-256'
const PREFIX = 'sha256='

/** Decode hex to bytes, or `null` when the input is not hex. */
function fromHex(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0) return null
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
    if (Number.isNaN(byte)) return null
    bytes[i] = byte
  }
  return bytes
}

/**
 * Build a {@link VerifyFn} that checks `X-Hub-Signature-256` against `secrets`.
 *
 * `secrets` is a list so a rotation is not an outage: during the overlap both the old and the new
 * secret verify, and deliveries signed with either are accepted. Every candidate is tried — the
 * loop does not stop at the first mismatch, so the number of secrets does not leak through timing.
 */
export function verifyHubSignature256(secrets: readonly string[]): VerifyFn {
  return async (req: Request): Promise<VerifyResult> => {
    const header = req.headers.get(HEADER)
    if (!header) return { ok: false, reason: `missing ${HEADER} header` }
    if (!header.startsWith(PREFIX)) {
      return { ok: false, reason: `malformed ${HEADER} header (missing ${PREFIX} prefix)` }
    }

    const signature = fromHex(header.slice(PREFIX.length))
    if (!signature) return { ok: false, reason: 'malformed signature hex' }

    const encoder = new TextEncoder()
    const body = encoder.encode(await req.text())

    let matched = false
    for (const secret of secrets) {
      const key = await globalThis.crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      )
      const expected = new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', key, body))
      if (signature.length !== expected.length) continue
      // No early return: leaving the loop on the first hit would make a run's duration depend on
      // WHICH secret matched, which is the same leak the byte comparison is written to avoid.
      if (timingSafeEqual(signature, expected)) matched = true
    }

    return matched ? { ok: true } : { ok: false, reason: 'signature mismatch' }
  }
}
