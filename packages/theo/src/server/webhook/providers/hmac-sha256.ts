/**
 * HMAC-SHA256 over the RAW body, shared by every platform that signs a webhook that way.
 *
 * Extracted when LINE became the third caller (#590). GitHub and Meta already shared one
 * implementation because, as that module put it, writing it twice duplicates "not a shape but a
 * security decision — the constant-time compare, the rejection of a malformed signature, the
 * per-secret loop that makes rotation survivable — and the second copy is the one that drifts".
 * That argument does not weaken when a third platform arrives with a different header and a
 * different encoding; the decision underneath is the same one.
 *
 * What varies between platforms is small and entirely at the edges: which header carries the
 * signature, and how to read bytes out of its value. Both arrive as parameters. What does not vary
 * — and is therefore not a parameter — is that the comparison is `timingSafeEqual` over raw BYTES,
 * that every candidate secret is tried without an early return, and that the body is read once,
 * raw, from the request this function is handed.
 *
 * Web Crypto rather than `node:crypto`, per ADR-0028: the same code has to run on Workers, Bun and
 * Deno.
 *
 * There is no timestamp in any of these schemes and therefore no replay window. Replay protection
 * is the handler's business (make it idempotent); claiming it here would be a promise this code
 * cannot keep.
 */
import { timingSafeEqual } from '../timing-safe-equal.js'
import type { VerifyFn, VerifyResult } from '../webhook-types.js'

import { configuredSecrets, refusingVerifier } from './configured-secret.js'

/**
 * The outcome of reading signature bytes out of a header value.
 *
 * Discriminated on `ok`, the same shape as {@link VerifyResult}, rather than `Uint8Array | {...}`:
 * a union of a class and an object literal is two kinds of return wearing one type, and the caller
 * has to `instanceof` its way back to which. It carries a `reason` rather than `null` because "no
 * prefix" and "not decodable" are different mistakes with different fixes, and collapsing them
 * costs the reader the one thing the error was for.
 */
export type DecodeResult = { ok: true; bytes: Uint8Array } | { ok: false; reason: string }

/** Read signature bytes out of a header value. */
export type DecodeSignature = (headerValue: string) => DecodeResult

/**
 * Build a {@link VerifyFn} that checks `header` against an HMAC-SHA256 of the raw body.
 *
 * `secrets` accepts one secret or a list, so a rotation is not an outage: during the overlap both
 * the old and the new secret verify. Every candidate is tried — the loop does not stop at the first
 * match, so the number of secrets, and which one matched, do not leak through timing.
 *
 * A configuration with no usable secret is refused HERE rather than in each caller, because this is
 * the function that reaches `importKey`, and a zero-length key is where it threw (#594). `option`
 * is the caller's name for the credential, so the refusal names what the operator has to set.
 */
export function verifyHmacSha256(opts: {
  header: string
  secrets: string | readonly string[]
  option: string
  decode: DecodeSignature
}): VerifyFn {
  const { header, decode } = opts

  const configured = configuredSecrets(opts.secrets, opts.option)
  if (!configured.ok) return refusingVerifier(configured.reason)
  const { secrets } = configured

  return async (req: Request): Promise<VerifyResult> => {
    const value = req.headers.get(header)
    if (!value) return { ok: false, reason: `missing ${header} header` }

    const decoded = decode(value)
    if (!decoded.ok) return { ok: false, reason: decoded.reason }

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
      if (decoded.bytes.length !== expected.length) continue
      // No early return: leaving the loop on the first hit would make a run's duration depend on
      // WHICH secret matched, which is the same leak the byte comparison is written to avoid.
      if (timingSafeEqual(decoded.bytes, expected)) matched = true
    }

    return matched ? { ok: true } : { ok: false, reason: 'signature mismatch' }
  }
}
