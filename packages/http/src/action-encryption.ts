/**
 * Action Encryption — AES-GCM-256 via Web Crypto API.
 *
 * A server-action payload cipher for the SSR path.
 * Uses crypto.subtle (Web Standard) for action argument encryption.
 * Random IV per call ensures ciphertext is unique even for identical inputs.
 *
 * Output format: base64url(iv || ciphertext)
 *
 * Every export here is deprecated; see the notice on each one, and `docs/adr/0015`.
 */

const ALGORITHM = 'AES-GCM'
const IV_LENGTH = 12 // 96-bit IV per NIST recommendation for AES-GCM

/** Warned once per process rather than per call: this runs on a request path. */
let warnedAboutLegacySalt = false

/**
 * The pre-B-215 derivation, kept so existing ciphertext still decrypts — and made loud.
 *
 * Silence is what made this survive: the docblock stated the mechanism honestly and then scoped
 * its caveat to password hashing, which is the wrong threat. The exposure is offline recovery of
 * this key from a single captured ciphertext.
 */
function legacySalt(encoder: TextEncoder, secret: string): Uint8Array<ArrayBuffer> {
  if (!warnedAboutLegacySalt) {
    warnedAboutLegacySalt = true
    try {
      console.warn(
        '[theokit] deriveActionKey was called with no salt, so it derived one FROM THE SECRET — ' +
          'the pre-B-215 behaviour, kept only so payloads encrypted under it still decrypt. That ' +
          'salt is not independent of the secret, so one precomputed table over likely secrets is ' +
          'valid against every deployment at once (NIST SP 800-132 5.1, OWASP A02:2021). Generate ' +
          'a random salt once, persist it beside the secret, and pass it as the second argument.',
      )
    } catch {
      // A failure inside the warning must not take down the derivation it is warning about.
    }
  }
  return encoder.encode(`theo-action-salt:${secret.slice(0, 8)}`)
}

/**
 * Derive an AES-GCM-256 CryptoKey from a string secret.
 *
 * Uses PBKDF2 with a fixed salt derived from the secret itself.
 * Suitable for action encryption where the secret is a server-side
 * session secret — not for password hashing.
 *
 * @deprecated Nothing in the action pipeline calls this, measured across every package and
 * app source tree: the three exports of this module occur 1, 2 and 1 times and every one is inside
 * this file. Reading the API beside an action pipeline invites the conclusion that action
 * arguments are encrypted for you — they are not, and that false belief is the reason this
 * carries a deprecation where an unused CSS helper would not need one.
 *
 * Still the right tool when you encrypt an action payload EXPLICITLY, in your own code. It keeps
 * working: no removal in 2.x, and removal only as a 3.0 change with this notice published ahead
 * of it (`docs/adr/0015`, on `docs/adr/0007`'s terms).
 */
export async function deriveActionKey(secret: string, salt?: BufferSource): Promise<CryptoKey> {
  const encoder = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    'PBKDF2',
    false,
    ['deriveKey'],
  )

  // B-215. A salt exists so derivation is unique per DEPLOYMENT and precomputation cannot be
  // amortised across targets. This used to be `theo-action-salt:${secret.slice(0, 8)}` — a pure
  // function of the secret it protects — so an attacker guessing the secret already knew the salt
  // for every candidate: one table over likely secrets was valid against every deployment at once,
  // and the only per-guess cost left was the iteration count. NIST SP 800-132 § 5.1 requires the
  // salt be generated independently of the secret; OWASP A02:2021 names the same condition.
  //
  // The parameter is OPTIONAL rather than required, and that is the compatibility half: a
  // deployment that already encrypted payloads under the old derivation keeps decrypting them.
  // Derivation stays deterministic for a given (secret, salt) pair, so storing a random salt
  // beside the secret is all a caller needs to move.
  const effectiveSalt = salt ?? legacySalt(encoder, secret)

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: effectiveSalt,
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
 *
 * @deprecated Nothing in the action pipeline calls this, measured across every package and
 * app source tree: the three exports of this module occur 1, 2 and 1 times and every one is inside
 * this file. Reading the API beside an action pipeline invites the conclusion that action
 * arguments are encrypted for you — they are not, and that false belief is the reason this
 * carries a deprecation where an unused CSS helper would not need one.
 *
 * Still the right tool when you encrypt an action payload EXPLICITLY, in your own code. It keeps
 * working: no removal in 2.x, and removal only as a 3.0 change with this notice published ahead
 * of it (`docs/adr/0015`, on `docs/adr/0007`'s terms).
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
 *
 * @deprecated Nothing in the action pipeline calls this, measured across every package and
 * app source tree: the three exports of this module occur 1, 2 and 1 times and every one is inside
 * this file. Reading the API beside an action pipeline invites the conclusion that action
 * arguments are encrypted for you — they are not, and that false belief is the reason this
 * carries a deprecation where an unused CSS helper would not need one.
 *
 * Still the right tool when you encrypt an action payload EXPLICITLY, in your own code. It keeps
 * working: no removal in 2.x, and removal only as a 3.0 change with this notice published ahead
 * of it (`docs/adr/0015`, on `docs/adr/0007`'s terms).
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
