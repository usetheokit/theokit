import { mkdtempSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SdkMessage } from '../bridge/event-translator.js'
import type { SdkAgentHandle } from '../bridge/sdk-adapter.js'
import { attachControlSocket } from './control-socket.js'
import { createControlClient } from './control-client.js'
import { createDevicePairing } from './device-pairing.js'
import { createSessionStore } from './session-store.js'
import { pairRoute } from './pair-route.js'
import { PairingRefusedError, redeemPairing } from './redeem-pairing.js'

const servers: Server[] = []
const handles: Array<{ close(): Promise<void> }> = []

afterEach(async () => {
  for (const h of handles.splice(0)) await h.close()
  for (const s of servers.splice(0)) await new Promise((r) => s.close(r))
})

const agent = {
  agentId: 'a',
  dispose: async () => {},
  send: async () => ({ cancel: async () => {}, wait: async () => ({ status: 'finished' }) }),
} as unknown as SdkAgentHandle<SdkMessage>

async function gateway(codeTtlMs?: number) {
  const pairing = createDevicePairing({
    dir: mkdtempSync(join(tmpdir(), 'redeem-')),
    ...(codeTtlMs === undefined ? {} : { codeTtlMs }),
  })
  const route = pairRoute(pairing)
  const server = createServer()
  servers.push(server)
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  handles.push(
    attachControlSocket(server, {
      authorize: (h) => pairing.accepts(h),
      sessions: createSessionStore({ build: vi.fn(async () => agent), drainMs: 50 }),
    }),
  )
  const base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`
  const fetchRoute = ((input: URL | string, init?: RequestInit) => {
    expect(String(input)).toBe(`${base}/control/pair`)
    return route(new Request(input, init))
  }) as typeof fetch
  return { pairing, base, fetchRoute }
}

describe('redeemPairing', () => {
  it('returns a credential the control client accepts once the owner approves', async () => {
    const { pairing, base, fetchRoute } = await gateway()
    const result = await redeemPairing({
      url: `${base}/anything`,
      code: pairing.issueCode(),
      name: 'phone',
      fetch: fetchRoute,
    })
    expect(result.url).toBe(`${base.replace('http', 'ws')}/control`)
    const [pending] = pairing.pending()
    await pairing.approve(pending?.id ?? '')
    const client = await createControlClient({
      url: result.url,
      authorization: `Bearer ${result.credential}`,
    })
    const frames = []
    for await (const frame of client.chat('hi', 's1')) frames.push(frame)
    expect(frames.at(-1)).toMatchObject({ type: 'done' })
    await client.close()
  })

  it('maps a wss address to https and back', async () => {
    const calls: string[] = []
    const result = await redeemPairing({
      url: 'wss://example.test/control',
      code: 'c',
      name: 'n',
      fetch: (async (input: URL) => {
        calls.push(String(input))
        return new Response('{}', { status: 202 })
      }) as unknown as typeof fetch,
    })
    expect(calls).toEqual(['https://example.test/control/pair'])
    expect(result.url).toBe('wss://example.test/control')
  })

  it('throws a typed error and returns no credential for an expired code', async () => {
    vi.useFakeTimers()
    try {
      const { pairing, base, fetchRoute } = await gateway(1000)
      const code = pairing.issueCode()
      vi.advanceTimersByTime(5000)
      const error = await redeemPairing({ url: base, code, name: 'phone', fetch: fetchRoute }).then(
        () => undefined,
        (e: unknown) => e,
      )
      expect(error).toBeInstanceOf(PairingRefusedError)
      expect((error as PairingRefusedError).status).toBe(401)
      expect((error as PairingRefusedError).reason).toBe('unknown_or_expired')
      expect(pairing.pending()).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects an address that is not http(s) or ws(s)', async () => {
    await expect(redeemPairing({ url: 'ftp://x', code: 'c', name: 'n' })).rejects.toBeInstanceOf(
      PairingRefusedError,
    )
  })
})
