/**
 * `X-Hub-Signature-256` — HMAC-SHA256 over the RAW body, hex, prefixed `sha256=`.
 *
 * One implementation for the two platforms that use it. GitHub and Meta (WhatsApp, Instagram,
 * Messenger) send the same header under the same construction, because both descend from the
 * PubSubHubbub convention the name comes from.
 *
 * The HMAC itself moved to `hmac-sha256.ts` when LINE became a third caller with the same
 * construction under a different header and encoding (#590). What stayed here is what is actually
 * specific to this scheme: the header name, the `sha256=` prefix, and hex decoding. The security
 * decisions the old docblock defended — the constant-time compare over raw bytes, the per-secret
 * loop with no early return — did not move out of one place; they moved to the one place all three
 * platforms share.
 *
 * There is no timestamp in this scheme and therefore no replay window. Replay protection is the
 * handler's business (make it idempotent); claiming it here would be a promise this code cannot
 * keep.
 */
import type { VerifyFn } from '../webhook-types.js'

import { verifyHmacSha256, type DecodeResult } from './hmac-sha256.js'

const HEADER = 'x-hub-signature-256'
const PREFIX = 'sha256='

/** Strip the `sha256=` prefix and decode hex to bytes, or say which of the two failed. */
function fromPrefixedHex(value: string): DecodeResult {
  if (!value.startsWith(PREFIX)) {
    return { ok: false, reason: `malformed ${HEADER} header (missing ${PREFIX} prefix)` }
  }
  const hex = value.slice(PREFIX.length)
  if (hex.length % 2 !== 0) return { ok: false, reason: 'malformed signature hex' }

  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
    if (Number.isNaN(byte)) return { ok: false, reason: 'malformed signature hex' }
    bytes[i] = byte
  }
  return { ok: true, bytes }
}

/**
 * Build a {@link VerifyFn} that checks `X-Hub-Signature-256` against `secrets`.
 *
 * `secrets` accepts one secret or a list, so a rotation is not an outage: during the overlap both
 * the old and the new secret verify, and deliveries signed with either are accepted.
 *
 * `option` is the caller's name for the credential — GitHub calls it `secret` and Meta calls it
 * `appSecret` — and it travels through so a refusal names the option the reader actually wrote
 * (#594).
 */
export function verifyHubSignature256(
  secrets: string | readonly string[],
  option: string,
): VerifyFn {
  return verifyHmacSha256({ header: HEADER, secrets, option, decode: fromPrefixedHex })
}
