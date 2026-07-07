/**
 * M27 — Telegram webhook verification.
 *
 * Telegram does NOT sign the body; it echoes a caller-configured secret token in the
 * `X-Telegram-Bot-Api-Secret-Token` header (set via `setWebhook(secret_token=...)`). Verification is
 * a constant-time compare of that header against the configured secret.
 *
 * @see https://core.telegram.org/bots/api#setwebhook
 */
import { timingSafeEqual } from '../timing-safe-equal.js'
import type { VerifyFn, VerifyResult } from '../webhook-types.js'

export interface TelegramWebhookOptions {
  /** The `secret_token` configured on `setWebhook` (1–256 chars). */
  secretToken: string
}

export function telegram(opts: TelegramWebhookOptions): VerifyFn {
  const enc = new TextEncoder()
  const expected = enc.encode(opts.secretToken)

  return (req: Request): VerifyResult => {
    const header = req.headers.get('x-telegram-bot-api-secret-token')
    if (!header) {
      return { ok: false, reason: 'missing x-telegram-bot-api-secret-token header' }
    }
    const got = enc.encode(header)
    if (got.length !== expected.length) return { ok: false, reason: 'secret token mismatch' }
    return timingSafeEqual(got, expected)
      ? { ok: true }
      : { ok: false, reason: 'secret token mismatch' }
  }
}
