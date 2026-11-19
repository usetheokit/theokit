import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { afterEach, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'

import type { SdkAgentHandle } from '../bridge/sdk-adapter.js'
import * as entry from '../control-entry.js'
import { attachControlSocket } from './control-socket.js'
import { createSessionStore } from './session-store.js'

function fakeAgent(hold: boolean): { agent: SdkAgentHandle; cancel: ReturnType<typeof vi.fn> } {
  const cancel = vi.fn(async () => {})
  const agent = {
    agentId: 'a',
    dispose: async () => {},
    send: async () => ({
      cancel,
      wait: async () => {
        if (hold) await new Promise<void>(() => undefined)
        return { status: 'finished' }
      },
    }),
  } as unknown as SdkAgentHandle
  return { agent, cancel }
}

const open: Array<{ close(): Promise<void> }> = []
const servers: Server[] = []

async function start(
  extra: Partial<Parameters<typeof attachControlSocket>[1]> = {},
  hold = false,
  build = vi.fn(async () => fakeAgent(hold).agent),
): Promise<{ url: string; build: typeof build }> {
  const server = createServer()
  servers.push(server)
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const sessions = createSessionStore({ build, drainMs: 50 })
  const handle = attachControlSocket(server, {
    authorize: () => true,
    sessions,
    ...extra,
  })
  open.push(handle, sessions)
  return { url: `ws://127.0.0.1:${(server.address() as AddressInfo).port}`, build }
}

afterEach(async () => {
  for (const h of open.splice(0)) await h.close()
  for (const s of servers.splice(0)) await new Promise((r) => s.close(r))
})

function connect(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    ws.once('open', () => resolve(ws))
    ws.once('error', reject)
  })
}

function refused(url: string): Promise<number | undefined> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url)
    ws.once('unexpected-response', (_req, res) => resolve(res.statusCode))
    ws.once('error', () => undefined)
  })
}

function next(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    ws.once('message', (d) => resolve(JSON.parse(d.toString()) as Record<string, unknown>))
  })
}

describe('attachControlSocket', () => {
  it('is exported from the control entry', () => {
    expect(entry.attachControlSocket).toBe(attachControlSocket)
  })

  it('an upgrade on another path is refused with 404 and builds no agent', async () => {
    const { url, build } = await start()
    expect(await refused(`${url}/other`)).toBe(404)
    expect(build).not.toHaveBeenCalled()
  })

  it('an upgrade that authorize rejects is refused with 401', async () => {
    const { url, build } = await start({ authorize: () => false })
    expect(await refused(`${url}/control`)).toBe(401)
    expect(build).not.toHaveBeenCalled()
  })

  it('a frame above maxPayloadBytes closes the socket with 1009', async () => {
    const { url } = await start({ maxPayloadBytes: 32 })
    const ws = await connect(`${url}/control`)
    const closed = new Promise<number>((r) => ws.once('close', (code) => r(code)))
    ws.send(JSON.stringify({ type: 'chat', message: 'x'.repeat(100) }))
    expect(await closed).toBe(1009)
  })

  it('a malformed frame answers an error frame with code bad_frame and keeps the socket open', async () => {
    const { url } = await start()
    const ws = await connect(`${url}/control`)
    const reply = next(ws)
    ws.send('not json')
    expect(await reply).toEqual({ type: 'error', code: 'bad_frame' })
    expect(ws.readyState).toBe(WebSocket.OPEN)
    ws.close()
  })

  it('a chat answers done', async () => {
    const { url } = await start()
    const ws = await connect(`${url}/control`)
    const reply = next(ws)
    ws.send(JSON.stringify({ type: 'chat', message: 'hi', session: 's1' }))
    expect(await reply).toMatchObject({ type: 'done', session: 's1' })
    ws.close()
  })

  it('interrupt on an idle session answers no_turn', async () => {
    const { url } = await start()
    const ws = await connect(`${url}/control`)
    const reply = next(ws)
    ws.send(JSON.stringify({ type: 'interrupt', session: 'idle' }))
    expect(await reply).toEqual({ type: 'no_turn', session: 'idle' })
    ws.close()
  })

  it('closing a socket cancels its running session turns', async () => {
    const f = fakeAgent(true)
    const { url, build } = await start({}, true, vi.fn(async () => f.agent))
    const ws = await connect(`${url}/control`)
    ws.send(JSON.stringify({ type: 'chat', message: 'hi', session: 's1' }))
    await vi.waitFor(() => expect(build).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 30))
    ws.close()
    await vi.waitFor(() => expect(f.cancel).toHaveBeenCalled())
  })
})
