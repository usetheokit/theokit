/**
 * Action Encryption — AES-GCM-256 via Web Crypto API.
 *
 * Inspired by Next.js encryption.ts (app-render/).
 * Uses crypto.subtle (Web Standard) for action argument encryption.
 * Random IV per call ensures ciphertext is unique even for identical inputs.
 *
 * Output format: base64url(iv || ciphertext)
 */

const ALGORITHM = 'AES-GCM'
const IV_LENGTH = 12 // 96-bit IV per NIST recommendation for AES-GCM

/**
 * Derive an AES-GCM-256 CryptoKey from a string secret.
 *
 * Uses PBKDF2 with a fixed salt derived from the secret itself.
 * Suitable for action encryption where the secret is a server-side
 * session secret — not for password hashing.
 */
export async function deriveActionKey(secret: string): Promise<CryptoKey> {
  const encoder = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    'PBKDF2',
    false,
    ['deriveKey'],
  )

  const salt = encoder.encode(`theo-action-salt:${secret.slice(0, 8)}`)

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100_000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: ALGORITHM, length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/**
 * Encrypt a string with AES-GCM-256.
 *
 * @returns base64url-encoded string containing IV + ciphertext.
 */
export async function encryptActionArgs(key: CryptoKey, data: string): Promise<string> {
  const encoder = new TextEncoder()
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))

  const ciphertext = await crypto.subtle.encrypt({ name: ALGORITHM, iv }, key, encoder.encode(data))

  // Concatenate IV + ciphertext into a single buffer
  const combined = new Uint8Array(IV_LENGTH + ciphertext.byteLength)
  combined.set(iv, 0)
  combined.set(new Uint8Array(ciphertext), IV_LENGTH)

  return toBase64Url(combined)
}

/**
 * Decrypt a base64url-encoded string produced by encryptActionArgs.
 *
 * @returns The original plaintext string.
 * @throws Error if decryption fails (wrong key, tampered data, etc.).
 */
export async function decryptActionArgs(key: CryptoKey, encrypted: string): Promise<string> {
  const combined = fromBase64Url(encrypted)

  const iv = combined.slice(0, IV_LENGTH)
  const ciphertext = combined.slice(IV_LENGTH)

  const decrypted = await crypto.subtle.decrypt({ name: ALGORITHM, iv }, key, ciphertext)

  return new TextDecoder().decode(decrypted)
}

// --- base64url helpers (Web Standard, no Node deps) ---

function toBase64Url(bytes: Uint8Array): string {
  const binString = Array.from(bytes, (b) => String.fromCodePoint(b)).join('')
  return btoa(binString).replace(/\+/g, '-').replace(/\//g, '_').replaceAll('=', '')
}

function fromBase64Url(str: string): Uint8Array {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  const binString = atob(padded)
  return Uint8Array.from(binString, (c) => c.codePointAt(0)!)
}
