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
