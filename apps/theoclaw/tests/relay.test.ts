import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { RelayClient, relayTools } from '../src/relay/relay-client.js'
import { generateIdentity, open, seal, type TrustedPeers } from '../src/relay/relay-crypto.js'
import { RelayMailbox, relayRoute } from '../src/relay/relay-server.js'
import { readRelaySettings } from '../src/relay/relay-settings.js'
import { RelayState } from '../src/relay/relay-state.js'
import { serveHandler } from '../src/control-plane/http-dispatch.js'

const TOKEN = 'r'.repeat(40)

function dir(): string {
  return mkdtempSync(join(tmpdir(), 'relay-'))
}

describe('relay crypto (OC-14)', () => {
  const a = generateIdentity()
  const b = generateIdentity()
  const c = generateIdentity()
  const aTrusts: TrustedPeers = new Map([['b', b.publicKey]])
  const bTrusts: TrustedPeers = new Map([['a', a.publicKey]])

  it('round-trips and hides the plaintext', () => {
    const env = seal(a, aTrusts, 'b', 'secret plan', 1)
    expect(JSON.stringify(env)).not.toContain('secret plan')
    expect(open(b, bTrusts, env)).toEqual({ from: 'a', plaintext: 'secret plan' })
  })

  it('refuses untrusted peers, tampering, wrong recipient, spoofed sender and a changed seq', () => {
    expect(() => seal(a, aTrusts, 'c', 'x', 1)).toThrow(/not trusted/)
    expect(() => open(b, bTrusts, seal(c, new Map([['b', b.publicKey]]), 'b', 'x', 1))).toThrow(
      /not trusted/,
    )
    const env = seal(a, aTrusts, 'b', 'hello', 1)
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
    expect(() => open(b, bTrusts, { ...env, seq: 2 })).toThrow(/authenticate/)
  })
})

describe('two instances through an HTTP relay (OC-14)', () => {
  function setup() {
    const idA = RelayState.load(join(dir(), 'a.json'), new Map())
    const idB = RelayState.load(join(dir(), 'b.json'), new Map())
    const fileA = join(dir(), 'a.json')
    const fileB = join(dir(), 'b.json')
    const a = RelayState.load(fileA, new Map([['bob', idB.publicKey]]))
    const b = RelayState.load(fileB, new Map([['alice', a.publicKey]]))
    // b's key changed with its file; rebuild a so it trusts the real b.
    const a2 = RelayState.load(fileA, new Map([['bob', b.publicKey]]))
    void idA
    const mailbox = new RelayMailbox()
    const route = relayRoute(TOKEN, mailbox)
    const handler = serveHandler(
      async () => new Response(null, { status: 404 }),
      undefined,
      undefined,
      undefined,
      undefined,
      route,
    )
    const fetchImpl = ((url: string, init: RequestInit) =>
      handler(new Request(url, init))) as unknown as typeof fetch
    const client = new RelayClient('http://127.0.0.1:1', TOKEN, fetchImpl)
    return { a: a2, b, mailbox, client, fetchImpl, files: { fileA, fileB } }
  }
  const tool = (state: RelayState, client: RelayClient, name: string) =>
    relayTools(state, client).find((t) => t.name === name)!

  it('a message sent by the tools reaches the peer, and the relay holds only ciphertext', async () => {
    const { a, b, client, mailbox } = setup()
    await tool(a, client, 'relay_send').handler({ peer: 'bob', message: 'meet at noon' })
    const waiting = JSON.stringify(mailbox.take(b.publicKey))
    expect(waiting).not.toContain('meet at noon')
    await tool(a, client, 'relay_send').handler({ peer: 'bob', message: 'meet at noon' })
    expect(await tool(b, client, 'relay_receive').handler({})).toBe('from alice: meet at noon')
    expect(await tool(b, client, 'relay_receive').handler({})).toBe('no messages')
  })

  it('drops a replayed envelope, also after a restart', async () => {
    const { a, b, client, mailbox, files } = setup()
    const env = a.seal('bob', 'once')
    await client.put(env)
    await client.put(env)
    expect(await tool(b, client, 'relay_receive').handler({})).toMatch(
      /^from alice: once\n\(1 envelope/,
    )
    const restarted = RelayState.load(files.fileB, b.trusted)
    await client.put(env)
    expect(await tool(restarted, client, 'relay_receive').handler({})).toMatch(/1 envelope/)
    expect(mailbox.take(b.publicKey)).toEqual([])
  })

  it('refuses a bad token, a bad body and a full mailbox', async () => {
    const { a, fetchImpl } = setup()
    const bad = new RelayClient('http://127.0.0.1:1', 'x'.repeat(40), fetchImpl)
    await expect(bad.put(a.seal('bob', 'x'))).rejects.toThrow(/401/)
    const small = relayRoute(TOKEN, new RelayMailbox(1))
    const post = (body: unknown) =>
      small(
        new Request('http://x/relay/put', {
          method: 'POST',
          headers: { authorization: `Bearer ${TOKEN}` },
          body: JSON.stringify(body),
        }),
      )
    expect((await post({ nope: 1 })).status).toBe(400)
    const env = a.seal('bob', 'x')
    expect((await post(env)).status).toBe(204)
    expect((await post(env)).status).toBe(507)
  })

  it('persists a mailbox across a restart', () => {
    const file = join(dir(), 'box.json')
    const env = seal(
      generateIdentity(),
      new Map([['p', generateIdentity().publicKey]]),
      'p',
      'x',
      1,
    )
    new RelayMailbox(10, file).put(env)
    expect(new RelayMailbox(10, file).take(env.to)).toEqual([env])
  })
})

describe('relay settings', () => {
  it('is off by default and validates the trust list and the url', () => {
    expect(readRelaySettings({})).toEqual({
      serveToken: undefined,
      client: undefined,
      peers: new Map(),
    })
    expect(() => readRelaySettings({ THEOCLAW_RELAY_PEERS: 'bob=short' })).toThrow(/PEERS/)
    expect(() =>
      readRelaySettings({
        THEOCLAW_RELAY_URL: 'http://example.com',
        THEOCLAW_RELAY_CLIENT_TOKEN: TOKEN,
      }),
    ).toThrow(/https/)
    expect(() => readRelaySettings({ THEOCLAW_RELAY_URL: 'https://example.com' })).toThrow(
      /CLIENT_TOKEN/,
    )
    const key = generateIdentity().publicKey
    const s = readRelaySettings({
      THEOCLAW_RELAY_URL: 'https://r.example/',
      THEOCLAW_RELAY_CLIENT_TOKEN: TOKEN,
      THEOCLAW_RELAY_PEERS: `bob=${key}`,
    })
    expect(s.client?.url).toBe('https://r.example')
    expect(s.peers.get('bob')).toBe(key)
  })
})
