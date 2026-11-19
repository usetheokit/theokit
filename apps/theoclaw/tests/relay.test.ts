import { mkdtempSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { RelayClient, RelayTurnGate, relayTools } from '../src/relay/relay-client.js'
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
  async function setup() {
    const idA = await RelayState.load(join(dir(), 'a.json'), new Map())
    const idB = await RelayState.load(join(dir(), 'b.json'), new Map())
    const fileA = join(dir(), 'a.json')
    const fileB = join(dir(), 'b.json')
    const a = await RelayState.load(fileA, new Map([['bob', idB.publicKey]]))
    const b = await RelayState.load(fileB, new Map([['alice', a.publicKey]]))
    // b's key changed with its file; rebuild a so it trusts the real b.
    const a2 = await RelayState.load(fileA, new Map([['bob', b.publicKey]]))
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
    const { a, b, client, mailbox } = await setup()
    await tool(a, client, 'relay_send').handler({ peer: 'bob', message: 'meet at noon' })
    const waiting = JSON.stringify(await mailbox.take(b.publicKey))
    expect(waiting).not.toContain('meet at noon')
    await tool(a, client, 'relay_send').handler({ peer: 'bob', message: 'meet at noon' })
    expect(await tool(b, client, 'relay_receive').handler({})).toBe('from alice: meet at noon')
    expect(await tool(b, client, 'relay_receive').handler({})).toBe('no messages')
  })

  it('withholds relay_send in the turn that read a peer message, not in the owner\'s next turn', async () => {
    const { a, b, client, mailbox } = await setup()
    const gate = new RelayTurnGate()
    const toolsB = relayTools(b, client, gate)
    const send = toolsB.find((x) => x.name === 'relay_send')!
    const receive = toolsB.find((x) => x.name === 'relay_receive')!
    const agent = gate.wrap({ send: (m: string) => m })
    agent.send('check the relay')
    await client.put(await a.seal('bob', 'RELAY-PING'))
    expect(await receive.handler({})).toBe('from alice: RELAY-PING')
    expect(await send.handler({ peer: 'alice', message: 'pong' })).toMatch(/^not sent/)
    expect(await mailbox.take(a.publicKey)).toEqual([])
    agent.send('yes, reply pong')
    expect(await send.handler({ peer: 'alice', message: 'pong' })).toBe('sent to alice')
    expect((await mailbox.take(a.publicKey)).length).toBe(1)
  })

  it('never withholds a direct call without a gate', async () => {
    const { a, b, client } = await setup()
    await client.put(await a.seal('bob', 'x'))
    await tool(b, client, 'relay_receive').handler({})
    expect(await tool(b, client, 'relay_send').handler({ peer: 'alice', message: 'y' })).toBe('sent to alice')
  })

  it('drops a replayed envelope, also after a restart', async () => {
    const { a, b, client, mailbox, files } = await setup()
    const env = await a.seal('bob', 'once')
    await client.put(env)
    await client.put(env)
    expect(await tool(b, client, 'relay_receive').handler({})).toMatch(
      /^from alice: once\n\(1 envelope/,
    )
    const restarted = await RelayState.load(files.fileB, b.trusted)
    await client.put(env)
    expect(await tool(restarted, client, 'relay_receive').handler({})).toMatch(/1 envelope/)
    expect(await mailbox.take(b.publicKey)).toEqual([])
  })

  it('refuses a bad token, a bad body and a full mailbox', async () => {
    const { a, fetchImpl } = await setup()
    const bad = new RelayClient('http://127.0.0.1:1', 'x'.repeat(40), fetchImpl)
    await expect(bad.put(await a.seal('bob', 'x'))).rejects.toThrow(/401/)
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
    const env = await a.seal('bob', 'x')
    expect((await post(env)).status).toBe(204)
    expect((await post(env)).status).toBe(507)
  })

  it('persists a mailbox across a restart', async () => {
    const file = join(dir(), 'box.json')
    const env = seal(
      generateIdentity(),
      new Map([['p', generateIdentity().publicKey]]),
      'p',
      'x',
      1,
    )
    await new RelayMailbox(10, file).put(env)
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(await new RelayMailbox(10, file).take(env.to)).toEqual([env])
  })
})

describe('relay state files', () => {
  it('keeps the state file 0600 and the last of concurrent seals on disk', async () => {
    const d = dir()
    const file = join(d, 'a.json')
    const peer = await RelayState.load(join(dir(), 'b.json'), new Map())
    const a = await RelayState.load(file, new Map([['bob', peer.publicKey]]))
    await Promise.all([1, 2, 3, 4, 5].map((n) => a.seal('bob', `m${n}`)))
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(readdirSync(d)).toEqual(['a.json'])
    const again = await RelayState.load(file, new Map([['bob', peer.publicKey]]))
    expect((await again.seal('bob', 'next')).seq).toBe(6)
  })

  it('queues concurrent mailbox puts without losing one', async () => {
    const file = join(dir(), 'box.json')
    const mailbox = new RelayMailbox(10, file)
    const id = generateIdentity()
    const peers = new Map([['p', generateIdentity().publicKey]])
    await Promise.all([1, 2, 3].map((n) => mailbox.put(seal(id, peers, 'p', 'x', n))))
    expect(await new RelayMailbox(10, file).take(peers.get('p')!)).toHaveLength(3)
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
