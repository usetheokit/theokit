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

import { decodeBase64Signature, verifyHmacSha256 } from './hmac-sha256.js'

const HEADER = 'x-line-signature'

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
    decode: decodeBase64Signature,
  })
}
