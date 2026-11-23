import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { RelayClient, RelayTurnGate, relayTools } from '../src/relay/relay-client.js'
import { generateA2AIdentity } from '@theokit/sdk/a2a'
import { relayRoute } from '../src/relay/relay-server.js'
import { readRelaySettings } from '../src/relay/relay-settings.js'
import { RelayState } from '../src/relay/relay-state.js'
import { serveHandler } from '../src/control-plane/http-dispatch.js'

const TOKEN = 'r'.repeat(40)

function dir(): string {
  return mkdtempSync(join(tmpdir(), 'relay-'))
}

async function post(route: (r: Request) => Promise<Response>, path: string, body: unknown, token = TOKEN) {
  return route(
    new Request(`http://x${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }),
  )
}

describe('two instances through an HTTP relay (OC-14)', () => {
  async function setup(mailboxFile?: string) {
    const fileA = join(dir(), 'a.json')
    const fileB = join(dir(), 'b.json')
    const idA = await RelayState.load(fileA, new Map())
    const idB = await RelayState.load(fileB, new Map())
    const a = await RelayState.load(fileA, new Map([['bob', idB.publicKey]]))
    const b = await RelayState.load(fileB, new Map([['alice', idA.publicKey]]))
    const route = relayRoute(TOKEN, mailboxFile === undefined ? {} : { persistPath: mailboxFile })
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
    const waiting = async (key: string) =>
      ((await (await post(route, '/relay/take', { recipient: key })).json()) as { envelopes: unknown[] })
        .envelopes
    return { a, b, route, client, fetchImpl, waiting, files: { fileA, fileB } }
  }
  const tool = (state: RelayState, client: RelayClient, name: string) =>
    relayTools(state, client).find((t) => t.name === name)!

  it('a message sent by the tools reaches the peer, and the relay holds only ciphertext', async () => {
    const { a, b, client, waiting } = await setup()
    await tool(a, client, 'relay_send').handler({ peer: 'bob', message: 'meet at noon' })
    expect(JSON.stringify(await waiting(b.publicKey))).not.toContain('meet at noon')
    await tool(a, client, 'relay_send').handler({ peer: 'bob', message: 'meet at noon' })
    expect(await tool(b, client, 'relay_receive').handler({})).toBe('from alice: meet at noon')
    expect(await tool(b, client, 'relay_receive').handler({})).toBe('no messages')
  })

  it('withholds relay_send in the turn that read a peer message, not in the owner\'s next turn', async () => {
    const { a, b, client, waiting } = await setup()
    const gate = new RelayTurnGate()
    const toolsB = relayTools(b, client, gate)
    const send = toolsB.find((x) => x.name === 'relay_send')!
    const receive = toolsB.find((x) => x.name === 'relay_receive')!
    const agent = gate.wrap({ send: (m: string) => m })
    agent.send('check the relay')
    await a.send(client.transport, 'bob', 'RELAY-PING')
    expect(await receive.handler({})).toBe('from alice: RELAY-PING')
    expect(await send.handler({ peer: 'alice', message: 'pong' })).toMatch(/^not sent/)
    expect(await waiting(a.publicKey)).toEqual([])
    agent.send('yes, reply pong')
    expect(await send.handler({ peer: 'alice', message: 'pong' })).toBe('sent to alice')
    expect((await waiting(a.publicKey)).length).toBe(1)
  })

  it('never withholds a direct call without a gate', async () => {
    const { a, b, client } = await setup()
    await a.send(client.transport, 'bob', 'x')
    await tool(b, client, 'relay_receive').handler({})
    expect(await tool(b, client, 'relay_send').handler({ peer: 'alice', message: 'y' })).toBe('sent to alice')
  })

  it('refuses to send to a peer that is not trusted', async () => {
    const { a, client } = await setup()
    await expect(a.send(client.transport, 'carol', 'x')).rejects.toThrow(/not trusted|carol/)
  })

  it('drops a replayed message, also after a restart', async () => {
    const { a, b, client, route, waiting, files } = await setup()
    // Capture the sealed message as it travels, then put it back twice.
    const sealedMessages: unknown[] = []
    const spy = {
      send: async (m: unknown) => void sealedMessages.push(m),
      poll: async () => [],
    }
    await a.send(spy as never, 'bob', 'once')
    for (let i = 0; i < 2; i++) await post(route, '/relay/put', { message: sealedMessages[0] })
    expect(await tool(b, client, 'relay_receive').handler({})).toBe('from alice: once')
    await post(route, '/relay/put', { message: sealedMessages[0] })
    expect(await tool(b, client, 'relay_receive').handler({})).toBe('no messages')
    const restarted = await RelayState.load(files.fileB, b.trusted)
    await post(route, '/relay/put', { message: sealedMessages[0] })
    expect(await tool(restarted, client, 'relay_receive').handler({})).toBe('no messages')
    expect(await waiting(b.publicKey)).toEqual([])
  })

  it('refuses a bad token, a bad body and a full mailbox', async () => {
    const { a, fetchImpl, route } = await setup()
    const bad = new RelayClient('http://127.0.0.1:1', 'x'.repeat(40), fetchImpl)
    await expect(a.send(bad.transport, 'bob', 'x')).rejects.toThrow(/401/)
    const small = relayRoute(TOKEN, { maxPerRecipient: 1 })
    expect((await post(small, '/relay/put', { nope: 1 })).status).toBe(400)
    const to = generateA2AIdentity().publicKey
    const message = { type: 't', payload: 1, from: 'f', to, timestamp: 1 }
    expect((await post(small, '/relay/put', { message })).status).toBe(200)
    expect((await post(small, '/relay/put', { message })).status).toBe(507)
    void route
  })

  it('persists a mailbox across a restart', async () => {
    const file = join(dir(), 'box.json')
    const first = await setup(file)
    await first.a.send(first.client.transport, 'bob', 'queued')
    expect(statSync(file).mode & 0o777).toBe(0o600)
    // A second mailbox handler on the same file serves what the first one stored.
    const again = relayRoute(TOKEN, { persistPath: file })
    const taken = (await (await post(again, '/relay/take', { recipient: first.b.publicKey })).json()) as {
      envelopes: unknown[]
    }
    expect(taken.envelopes).toHaveLength(1)
  })
})

describe('relay state files', () => {
  it('keeps the files 0600 and every concurrent send counted', async () => {
    const d = dir()
    const file = join(d, 'a.json')
    const peer = await RelayState.load(join(dir(), 'b.json'), new Map())
    const a = await RelayState.load(file, new Map([['bob', peer.publicKey]]))
    const sent: { payload: { seq: number } }[] = []
    const spy = { send: async (m: never) => void sent.push(m), poll: async () => [] }
    await Promise.all([1, 2, 3, 4, 5].map((n) => a.send(spy, 'bob', `m${n}`)))
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(readdirSync(d).sort()).toEqual(['a-sequences.json', 'a.json'])
    const again = await RelayState.load(file, new Map([['bob', peer.publicKey]]))
    await again.send(spy, 'bob', 'next')
    expect(sent.map((m) => m.payload.seq).sort()).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('two first loads of a missing file share one identity', async () => {
    const file = join(dir(), 'a.json')
    const [one, two] = await Promise.all([RelayState.load(file, new Map()), RelayState.load(file, new Map())])
    expect(one.publicKey).toBe(two.publicKey)
    expect((await RelayState.load(file, new Map())).publicKey).toBe(one.publicKey)
  })

  it('keeps the identity and the counters of a state file written before the SDK transport', async () => {
    const d = dir()
    const file = join(d, 'a.json')
    const identity = generateA2AIdentity()
    const peer = generateA2AIdentity()
    writeFileSync(
      file,
      JSON.stringify({ identity, sent: { [peer.publicKey]: 7 }, received: { [peer.publicKey]: 3 } }),
    )
    const a = await RelayState.load(file, new Map([['bob', peer.publicKey]]))
    expect(a.publicKey).toBe(identity.publicKey)
    const sent: { payload: { seq: number } }[] = []
    await a.send({ send: async (m: never) => void sent.push(m), poll: async () => [] }, 'bob', 'x')
    expect(sent[0]!.payload.seq).toBe(8)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ identity })
    expect(JSON.parse(readFileSync(join(d, 'a-sequences.json'), 'utf8')).received).toEqual({
      [peer.publicKey]: 3,
    })
  })

  it('closes the send gate as soon as a message is accepted, before its counter write ends', async () => {
    const fileB = join(dir(), 'b.json')
    const idB = await RelayState.load(fileB, new Map())
    const a = await RelayState.load(join(dir(), 'a.json'), new Map([['bob', idB.publicKey]]))
    const b = await RelayState.load(fileB, new Map([['alice', a.publicKey]]))
    const box: unknown[] = []
    const wire = {
      send: async (m: unknown) => void box.push(m),
      poll: async () => box.splice(0),
    }
    await a.send(wire as never, 'bob', 'hi')
    const gate = new RelayTurnGate()
    const reading = b.receive(wire as never, () => gate.markReceived())
    await new Promise((r) => setImmediate(r))
    expect(gate.blocked).toBe(true)
    expect((await reading).map((m) => m.plaintext)).toEqual(['hi'])
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
    const key = generateA2AIdentity().publicKey
    const s = readRelaySettings({
      THEOCLAW_RELAY_URL: 'https://r.example/',
      THEOCLAW_RELAY_CLIENT_TOKEN: TOKEN,
      THEOCLAW_RELAY_PEERS: `bob=${key}`,
    })
    expect(s.client?.url).toBe('https://r.example')
    expect(s.peers.get('bob')).toBe(key)
  })
})
