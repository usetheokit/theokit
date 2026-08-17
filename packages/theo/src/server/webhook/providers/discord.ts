/**
 * M27 — Discord interaction webhook verification.
 *
 * Discord signs each request with Ed25519. Headers: `X-Signature-Ed25519` (hex signature) and
 * `X-Signature-Timestamp`. The signed message is `timestamp + rawBody`; verify against the app's
 * public key (hex). Uses Web Crypto Ed25519 (Node ≥ 22) — no third-party crypto (Rule 9 / Web
 * Standards G8).
 *
 * @see https://discord.com/developers/docs/interactions/overview#setting-up-an-endpoint-validating-security-request-headers
 */
import type { VerifyFn, VerifyResult } from '../webhook-types.js'

export interface DiscordWebhookOptions {
  /** The Discord application's public key (hex). */
  publicKey: string
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> | null {
  if (hex.length === 0 || hex.length % 2 !== 0) return null
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
    if (Number.isNaN(byte)) return null
    bytes[i] = byte
  }
  return bytes
}

export function discord(opts: DiscordWebhookOptions): VerifyFn {
  const keyBytes = fromHex(opts.publicKey)

  return async (req: Request): Promise<VerifyResult> => {
    if (!keyBytes) return { ok: false, reason: 'malformed public key hex' }
    const sigHex = req.headers.get('x-signature-ed25519')
    const timestamp = req.headers.get('x-signature-timestamp')
    if (!sigHex) return { ok: false, reason: 'missing x-signature-ed25519 header' }
    if (!timestamp) return { ok: false, reason: 'missing x-signature-timestamp header' }

    const sigBytes = fromHex(sigHex)
    if (!sigBytes) return { ok: false, reason: 'malformed signature hex' }

    const rawBody = await req.text()
    const message = new Uint8Array(new TextEncoder().encode(timestamp + rawBody))

    try {
      const key = await globalThis.crypto.subtle.importKey(
        'raw',
        keyBytes,
        { name: 'Ed25519' },
        false,
        ['verify'],
      )
      const ok = await globalThis.crypto.subtle.verify('Ed25519', key, sigBytes, message)
      return ok ? { ok: true } : { ok: false, reason: 'signature mismatch' }
    } catch (err) {
      return {
        ok: false,
        reason: `verification failed: ${err instanceof Error ? err.message : 'unknown'}`,
      }
    }
  }
}
