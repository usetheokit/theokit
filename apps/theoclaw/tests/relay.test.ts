import { describe, expect, it } from 'vitest'

import { generateIdentity, open, seal, type TrustedPeers } from '../src/relay/relay-crypto.js'
import { RelayMailbox } from '../src/relay/relay-server.js'

describe('claw-to-claw relay (OC-14)', () => {
  const a = generateIdentity()
  const b = generateIdentity()
  const c = generateIdentity()
  const aTrusts: TrustedPeers = new Map([['b', b.publicKey]])
  const bTrusts: TrustedPeers = new Map([['a', a.publicKey]])

  it('delivers a message through a relay that only sees ciphertext', () => {
    const relay = new RelayMailbox()
    relay.put(seal(a, aTrusts, 'b', 'secret plan 🦀'))
    const stored = JSON.stringify(relay.take(b.publicKey))
    expect(stored).not.toContain('secret plan')
    relay.put(seal(a, aTrusts, 'b', 'secret plan 🦀'))
    const [env] = relay.take(b.publicKey)
    expect(open(b, bTrusts, env!)).toEqual({ from: 'a', plaintext: 'secret plan 🦀' })
    expect(relay.take(b.publicKey)).toEqual([])
  })

  it('refuses to seal to or open from an untrusted peer', () => {
    expect(() => seal(a, aTrusts, 'c', 'x')).toThrow(/not trusted/)
    const env = seal(c, new Map([['b', b.publicKey]]), 'b', 'x')
    expect(() => open(b, bTrusts, env)).toThrow(/not trusted/)
  })

  it('refuses a tampered envelope, a wrong recipient and a spoofed sender', () => {
    const env = seal(a, aTrusts, 'b', 'hello')
    const flipped = Buffer.from(env.ciphertext, 'base64url')
    flipped[0] = flipped[0]! ^ 1
    expect(() => open(b, bTrusts, { ...env, ciphertext: flipped.toString('base64url') })).toThrow(
      /authenticate/,
    )
    expect(() => open(c, new Map([['a', a.publicKey]]), env)).toThrow(/not addressed/)
    const both: TrustedPeers = new Map([
      ['a', a.publicKey],
      ['c', c.publicKey],
    ])
    expect(() => open(b, both, { ...env, from: c.publicKey })).toThrow(/authenticate/)
  })

  it('bounds a mailbox', () => {
    const relay = new RelayMailbox(1)
    relay.put(seal(a, aTrusts, 'b', '1'))
    expect(() => relay.put(seal(a, aTrusts, 'b', '2'))).toThrow(/full/)
  })
})
