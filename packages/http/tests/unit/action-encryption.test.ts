import { describe, it, expect } from 'vitest'
import {
  encryptActionArgs,
  decryptActionArgs,
  deriveActionKey,
} from '../../src/action-encryption.js'

describe('Action Encryption (AES-GCM via crypto.subtle)', () => {
  it('test_roundtrip_encrypts_and_decrypts', async () => {
    // Given: a key derived from a secret and a plaintext message
    const key = await deriveActionKey('my-super-secret-key-1234')
    const plaintext = 'hello world'

    // When: encrypt then decrypt
    const encrypted = await encryptActionArgs(key, plaintext)
    const decrypted = await decryptActionArgs(key, encrypted)

    // Then: decrypted matches original
    expect(decrypted).toBe(plaintext)
  })

  it('test_different_ciphertext_per_call', async () => {
    // Given: same key and same plaintext
    const key = await deriveActionKey('my-secret')
    const plaintext = 'same input'

    // When: encrypt twice
    const encrypted1 = await encryptActionArgs(key, plaintext)
    const encrypted2 = await encryptActionArgs(key, plaintext)

    // Then: ciphertexts differ (random IV per call)
    expect(encrypted1).not.toBe(encrypted2)

    // And: both decrypt to the same plaintext
    expect(await decryptActionArgs(key, encrypted1)).toBe(plaintext)
    expect(await decryptActionArgs(key, encrypted2)).toBe(plaintext)
  })

  // B-215. The salt was `theo-action-salt:${secret.slice(0, 8)}` — a pure function of the secret it
  // exists to protect. A salt is there so key derivation is unique per DEPLOYMENT and precomputation
  // cannot be amortised across targets; derived from the secret, an attacker guessing the secret
  // already knows the salt for every candidate, so one table over likely secrets is valid against
  // every deployment at once and the only per-guess cost left is the iteration count.
  //
  // NIST SP 800-132 § 5.1 requires the salt be generated independently of the secret; OWASP
  // A02:2021 names the same condition. The exposure is offline recovery of the key from one
  // captured ciphertext, which is this function's actual threat model — the docblock scoped its
  // caveat to password hashing, which is the wrong threat.
  //
  // Measured before the fix: two different salts produced the same key, so one deployment's
  // ciphertext decrypted with the other's key.
  it('test_an_explicit_salt_makes_the_key_independent_of_the_secret', async () => {
    const secret = 'a-server-side-session-secret-value'
    const saltA = new Uint8Array(16).fill(1)
    const saltB = new Uint8Array(16).fill(2)

    const keyA = await deriveActionKey(secret, saltA)
    const keyB = await deriveActionKey(secret, saltB)
    const ciphertext = await encryptActionArgs(keyA, 'payload')

    await expect(
      decryptActionArgs(keyB, ciphertext),
      'the same secret under two different salts produced the same key',
    ).rejects.toThrow()
  })

  it('test_the_same_salt_still_reproduces_the_key', async () => {
    // The control, and the half that makes the change safe: derivation stays deterministic for a
    // given (secret, salt) pair, so a deployment that stores its salt keeps decrypting what it
    // already encrypted.
    const secret = 'a-server-side-session-secret-value'
    const salt = new Uint8Array(16).fill(7)

    const ciphertext = await encryptActionArgs(await deriveActionKey(secret, salt), 'payload')

    expect(await decryptActionArgs(await deriveActionKey(secret, salt), ciphertext)).toBe('payload')
  })

  it('test_wrong_key_fails_decryption', async () => {
    // Given: two different keys
    const key1 = await deriveActionKey('secret-a')
    const key2 = await deriveActionKey('secret-b')
    const plaintext = 'sensitive data'

    // When: encrypt with key1, decrypt with key2
    const encrypted = await encryptActionArgs(key1, plaintext)

    // Then: decryption fails
    await expect(decryptActionArgs(key2, encrypted)).rejects.toThrow()
  })

  it('test_output_is_base64url', async () => {
    // Given: a key and plaintext
    const key = await deriveActionKey('test-secret')
    const plaintext = 'test data'

    // When: encrypt
    const encrypted = await encryptActionArgs(key, plaintext)

    // Then: output is base64url (no +, /, or = characters)
    expect(encrypted).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('test_empty_string_roundtrip', async () => {
    // Given: an empty string (EC-6)
    const key = await deriveActionKey('test-secret')
    const plaintext = ''

    // When: encrypt then decrypt
    const encrypted = await encryptActionArgs(key, plaintext)
    const decrypted = await decryptActionArgs(key, encrypted)

    // Then: roundtrip preserves empty string
    expect(decrypted).toBe('')
  })

  it('test_large_payload_roundtrip', async () => {
    // Given: a large JSON string
    const key = await deriveActionKey('production-secret')
    const plaintext = JSON.stringify({
      users: Array.from({ length: 100 }, (_, i) => ({
        id: i,
        name: `User ${i}`,
        email: `user${i}@example.com`,
      })),
    })

    // When: encrypt then decrypt
    const encrypted = await encryptActionArgs(key, plaintext)
    const decrypted = await decryptActionArgs(key, encrypted)

    // Then: roundtrip preserves the full payload
    expect(decrypted).toBe(plaintext)
  })
})
