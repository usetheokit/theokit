/**
 * `X-Line-Signature` — HMAC-SHA256 over the RAW body, BASE64, with no prefix (#590).
 *
 * ## The two things this exists to stop each app from rediscovering
 *
 * **The body is signed as bytes.** A parsed-and-restringified body hashes differently and rejects
 * every correct delivery. `handleChannelWebhook` hands a validator a `clone()` precisely so the raw
 * bytes are still available; an app writing its own has to know that unprompted, and #534 and #556
 * are the same defect on other platforms.
 *
 * **It is base64, not hex.** A reader who copies the GitHub or WhatsApp validator — same algorithm,
 * same body, same secret — produces a hex digest and gets a 401 indistinguishable from a wrong
 * channel secret. The measured version of this cost the reporter a debugging round against LINE's
 * own endpoint test, because `verifyLineSignature(secret, body, signature)` takes three strings and
 * typechecks in any order.
 *
 * ## Why a named validator, when `validators` already accepts any `VerifyFn`
 *
 * It always did: `ChannelWebhookConfig.validators` is `Record<string, VerifyFn>`, and a custom
 * platform needs no permission from this module. That is what makes this different from the closed
 * provider registry of #579/#585 — that list REFUSED what it did not name, and this one refuses
 * nothing. What is added here is the knowledge above, paid once instead of once per app.
 */
import type { VerifyFn } from '../webhook-types.js'

import { verifyHmacSha256, type DecodeResult } from './hmac-sha256.js'

const HEADER = 'x-line-signature'

/** Standard base64: the alphabet plus `=` padding. LINE does not use the URL-safe variant. */
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/

/** Decode base64 to bytes, or say why the header value could not be one. */
function fromBase64(value: string): DecodeResult {
  // `atob` accepts some inputs a strict decoder would not, so the shape is checked first: an
  // unchecked `atob` turns a typo into a length mismatch and then into "signature mismatch",
  // which sends the reader looking at their channel secret instead of at their header.
  if (value.length === 0 || value.length % 4 !== 0 || !BASE64.test(value)) {
    return { ok: false, reason: 'malformed signature base64' }
  }
  try {
    const binary = atob(value)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return { ok: true, bytes }
  } catch {
    return { ok: false, reason: 'malformed signature base64' }
  }
}

export interface LineWebhookOptions {
  /**
   * The channel secret from the LINE Developers console.
   *
   * An array rotates without an outage: during the overlap both the old and the new secret verify.
   */
  channelSecret: string | readonly string[]
}

/**
 * Build a {@link VerifyFn} for LINE Messaging API webhooks.
 *
 * ```ts
 * handleChannelWebhook(request, {
 *   validators: { line: line({ channelSecret: process.env.LINE_CHANNEL_SECRET! }) },
 * })
 * ```
 *
 * @public
 */
export function line(options: LineWebhookOptions): VerifyFn {
  return verifyHmacSha256({
    header: HEADER,
    secrets: options.channelSecret,
    option: 'channelSecret',
    decode: fromBase64,
  })
}
