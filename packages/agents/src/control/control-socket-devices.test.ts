import { mkdtempSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'

import { attachControlSocket, type ControlSocketOptions } from './control-socket.js'
import { createDevicePairing } from './device-pairing.js'

const CRED = 'abcdefghijklmnopqrstuvwxyz012345'
const open: Array<{ close(): Promise<void> }> = []
const servers: Server[] = []

async function start(options: Partial<ControlSocketOptions>): Promise<{ url: string }> {
  const server = createServer()
  servers.push(server)
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  open.push(attachControlSocket(server, { authorize: () => true, ...options }))
  return { url: `ws://127.0.0.1:${(server.address() as AddressInfo).port}/control` }
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

function next(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    ws.once('message', (d) => resolve(JSON.parse(d.toString()) as Record<string, unknown>))
  })
}

async function ask(ws: WebSocket, frame: unknown): Promise<Record<string, unknown>> {
  const answer = next(ws)
  ws.send(JSON.stringify(frame))
  return answer
}

describe('attachControlSocket without sessions', () => {
  it('runs a chat with no session through runTurn and merges doneFields', async () => {
    const { url } = await start({
      runTurn: async () => ({ ok: true, usage: { inputTokens: 1 } }),
      doneFields: () => ({ model: 'm' }),
    })
    const ws = await connect(url)
    expect(await ask(ws, { type: 'chat', message: 'hi', session: null })).toEqual({
      type: 'done',
      usage: { inputTokens: 1 },
      model: 'm',
    })
    ws.close()
  })

  it('answers bad_frame for a session frame and turn_failed when runTurn throws', async () => {
    const { url } = await start({
      runTurn: () => Promise.reject(new Error('boom')),
    })
    const ws = await connect(url)
    expect(await ask(ws, { type: 'interrupt', session: 's' })).toEqual({
      type: 'error',
      code: 'bad_frame',
    })
    expect(await ask(ws, { type: 'chat', message: 'hi' })).toEqual({
      type: 'error',
      code: 'turn_failed',
    })
    ws.close()
  })
})

describe('attachControlSocket device frames', () => {
  const pairing = (): ReturnType<typeof createDevicePairing> =>
    createDevicePairing({ dir: mkdtempSync(join(tmpdir(), 'sock-pairing-')) })

  it('lets an owner issue a code, approve and revoke a device, and closes a revoked socket', async () => {
    const devices = pairing()
    const { url } = await start({
      devices,
      authorize: (authorization) =>
        authorization === undefined
          ? { owner: true }
          : {
              owner: false,
              revoked: (close) =>
                devices.onRevoke((id) => {
                  if (id === devices.deviceIdFor(authorization)) close()
                }),
            },
    })
    const owner = await connect(url)
    const code = (await ask(owner, { type: 'pair_code' })).code as string
    const requested = devices.request(code, 'laptop', CRED, 'Oslo')
    if (!requested.ok) throw new Error('request refused')
    expect(await ask(owner, { type: 'pending_devices' })).toMatchObject({
      type: 'pending_devices',
      devices: [{ id: requested.id, name: 'laptop', city: 'Oslo' }],
    })
    expect(await ask(owner, { type: 'approve_device', id: requested.id })).toEqual({
      type: 'device_approved',
      id: requested.id,
      name: 'laptop',
    })
    expect(await ask(owner, { type: 'revoke_device', id: 5 })).toEqual({
      type: 'error',
      code: 'bad_frame',
    })
    expect(await ask(owner, { type: 'revoke_device', id: 'nope' })).toEqual({
      type: 'error',
      code: 'revoke_failed',
    })
    owner.close()
  })

  it('answers forbidden on a device socket and closes it once the device is revoked', async () => {
    const devices = pairing()
    const { url } = await start({
      devices,
      authorize: () => ({ owner: false, revoked: (close) => devices.onRevoke(() => close()) }),
    })
    const request = devices.request(devices.issueCode(), 'phone', CRED)
    if (!request.ok) throw new Error('request refused')
    await devices.approve(request.id)
    const ws = await connect(url)
    expect(await ask(ws, { type: 'pair_code' })).toEqual({ type: 'error', code: 'forbidden' })
    const closed = new Promise<number>((resolve) => ws.once('close', (code) => resolve(code)))
    expect(await devices.revokeDevice(request.id)).toBe(true)
    expect(await closed).toBe(1008)
  })
})
