/**
 * GitHub webhook signature verification per official spec.
 *
 * Header: `X-Hub-Signature-256: sha256=<hex>`
 * Algorithm: HMAC-SHA256(secret, rawBody) → hex
 *
 * The scheme itself lives in `hub-signature-256.ts`, shared with Meta's platforms (#556) — same
 * header, same construction, and the crypto decisions inside it are not worth having two copies of.
 * This file is what remains once the shared part is named: GitHub's option shape.
 *
 * No timestamp → no replay window. Replay protection is the caller's responsibility (idempotent
 * handler).
 *
 * @see https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
 */
import type { VerifyFn } from '../webhook-types.js'

import { verifyHubSignature256 } from './hub-signature-256.js'

export interface GitHubWebhookOptions {
  /** Webhook secret. Pass array for key rotation. */
  secret: string | readonly string[]
}

export function github(opts: GitHubWebhookOptions): VerifyFn {
  return verifyHubSignature256(opts.secret, 'secret')
}
