import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { RelayTurnGate, relayTools, type RelayClient } from '../src/relay/relay-client.js'
import { RelayState } from '../src/relay/relay-state.js'

const hold = vi.hoisted(() => ({
  pending: undefined as Promise<void> | undefined,
  entered: undefined as (() => void) | undefined,
}))

vi.mock('@theokit/sdk/a2a', async (importOriginal) => {
  const real = await importOriginal<typeof import('@theokit/sdk/a2a')>()
  return {
    ...real,
    // The counter write is held open while `hold.pending` is set.
    jsonSequenceStore: (file: string) => {
      const inner = real.jsonSequenceStore(file)
      return {
        nextSent: (peer: string) => inner.nextSent(peer),
        acceptReceived: async (peer: string, seq: number) => {
          if (hold.pending !== undefined) {
            hold.entered?.()
            await hold.pending
          }
          return inner.acceptReceived(peer, seq)
        },
      }
    },
  }
})

const dir = (): string => mkdtempSync(join(tmpdir(), 'relay-gate-'))

describe('relay send gate while the state write is pending', () => {
  it('blocks relay_send once relay_receive has accepted an envelope, before its write ends', async () => {
    const fileB = join(dir(), 'b.json')
    const idB = await RelayState.load(fileB, new Map())
    const a = await RelayState.load(join(dir(), 'a.json'), new Map([['bob', idB.publicKey]]))
    const b = await RelayState.load(fileB, new Map([['alice', a.publicKey]]))
    const box: unknown[] = []
    const transport = { send: async (m: unknown) => void box.push(m), poll: async () => box.splice(0) }
    await a.send(transport as never, 'bob', 'hi')
    const client = { transport } as unknown as RelayClient
    const gate = new RelayTurnGate()
    const tools = relayTools(b, client, gate)
    const send = tools.find((t) => t.name === 'relay_send')!
    const receive = tools.find((t) => t.name === 'relay_receive')!

    let release!: () => void
    hold.pending = new Promise<void>((resolve) => (release = resolve))
    const entered = new Promise<void>((resolve) => (hold.entered = resolve))
    const receiving = receive.handler({})
    await entered
    try {
      expect(await send.handler({ peer: 'alice', message: 'pong' })).toMatch(/^not sent/)
    } finally {
      hold.pending = undefined
      release()
    }
    expect(await receiving).toBe('from alice: hi')
  })
})
