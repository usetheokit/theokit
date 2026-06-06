// T5a.1c — Web Crypto migration. Uses globalThis.crypto.subtle.sign for
// HMAC-SHA256. Available in every runtime per ADR-0028 (Node 22+, CF
// Workers, Bun, Deno). The provider function was already async (returns
// Promise<VerifyResult>) so subtle.sign's Promise integrates with zero
// public API change.
import { timingSafeEqual } from '../timing-safe-equal.js'
import type { VerifyFn, VerifyResult } from '../webhook-types.js'

/**
 * GitHub webhook signature verification per official spec.
 *
 * Header: `X-Hub-Signature-256: sha256=<hex>`
 * Algorithm: HMAC-SHA256(secret, rawBody) → hex
 *
 * No timestamp → no replay window. Replay protection is the caller's
 * responsibility (idempotent handler).
 *
 * @see https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
 */

export interface GitHubWebhookOptions {
  /** Webhook secret. Pass array for key rotation. */
  secret: string | readonly string[]
}

const PREFIX = 'sha256='

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

export function github(opts: GitHubWebhookOptions): VerifyFn {
  const secrets: readonly string[] = Array.isArray(opts.secret)
    ? opts.secret
    : [opts.secret as string]

  return async (req: Request): Promise<VerifyResult> => {
    const header = req.headers.get('x-hub-signature-256')
    if (!header) {
      return { ok: false, reason: 'missing x-hub-signature-256 header' }
    }
    if (!header.startsWith(PREFIX)) {
      return { ok: false, reason: 'malformed x-hub-signature-256 header (missing sha256= prefix)' }
    }
    const sigHex = header.slice(PREFIX.length)
    const sigBytes = fromHex(sigHex)
    if (!sigBytes) {
      return { ok: false, reason: 'malformed signature hex' }
    }

    const rawBody = await req.text()
    const enc = new TextEncoder()
    const bodyBytes = enc.encode(rawBody)

    for (const secret of secrets) {
      // Web Crypto HMAC-SHA256: import secret as raw key, sign body bytes,
      // compare resulting bytes directly (skip hex round-trip — subtle.sign
      // returns the raw signature bytes which is what we need for timingSafeEqual).
      const key = await globalThis.crypto.subtle.importKey(
        'raw',
        enc.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      )
      const sigBuf = await globalThis.crypto.subtle.sign('HMAC', key, bodyBytes)
      const expectedBytes = new Uint8Array(sigBuf)
      if (sigBytes.length !== expectedBytes.length) continue
      if (timingSafeEqual(sigBytes, expectedBytes)) {
        return { ok: true }
      }
    }

    return { ok: false, reason: 'signature mismatch' }
  }
}
