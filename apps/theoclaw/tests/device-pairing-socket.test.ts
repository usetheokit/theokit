import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'

import { createDevicePairing } from '../src/control-plane/device-pairing.js'
import { serveHandler } from '../src/control-plane/http-dispatch.js'
import { type ControlPlaneHandle, listenControlPlane } from '../src/control-plane/listener.js'

const OWNER_TOKEN = 'owner-token-for-the-pairing-socket-tests-01'
const DEVICE_TOKEN = 'device-token-for-the-pairing-socket-tests-1'

let handle: ControlPlaneHandle | undefined
let dir = ''
const sockets: WebSocket[] = []

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate()
  await handle?.close()
  handle = undefined
  if (dir !== '') rmSync(dir, { recursive: true, force: true })
})

async function start(): Promise<void> {
  dir = mkdtempSync(join(tmpdir(), 'theoclaw-pair-socket-'))
  const devices = createDevicePairing({ dir })
  const notFound = (): Promise<Response> => Promise.resolve(new Response(null, { status: 404 }))
  handle = await listenControlPlane({
    handler: serveHandler(notFound, undefined, devices),
    port: 0,
    host: '127.0.0.1',
    control: { token: OWNER_TOKEN, runTurn: () => Promise.resolve({ ok: true }), devices },
    stderr: () => undefined,
  })
}

const base = (): string => `127.0.0.1:${handle!.address().port}`

/** The upgrade status for `token`, or 101 when it opened. */
function upgrade(token: string): Promise<{ status: number; socket?: WebSocket }> {
  return new Promise((resolve) => {
    const socket = new WebSocket(`ws://${base()}/control`, { headers: { Authorization: `Bearer ${token}` } })
    sockets.push(socket)
    socket.once('open', () => resolve({ status: 101, socket }))
    socket.once('unexpected-response', (_request, response) => resolve({ status: response.statusCode ?? 0 }))
    socket.on('error', () => undefined)
  })
}

/** Send one frame and resolve with the next frame back. */
function ask(socket: WebSocket, frame: unknown): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    socket.once('message', (raw) => resolve(JSON.parse(String(raw)) as Record<string, unknown>))
    socket.send(JSON.stringify(frame))
  })
}

const pair = (body: unknown): Promise<Response> =>
  fetch(`http://${base()}/control/pair`, { method: 'POST', body: JSON.stringify(body) })

describe('device pairing over /control', () => {
  it('an unapproved device is refused 401 and an approved one opens the socket', async () => {
    await start()
    const owner = (await upgrade(OWNER_TOKEN)).socket!
    const { code } = await ask(owner, { type: 'pair_code' })

    const pending = await pair({ code, name: 'laptop', token: DEVICE_TOKEN })
    expect(pending.status).toBe(202)
    const { id } = (await pending.json()) as { id: string }
    expect((await upgrade(DEVICE_TOKEN)).status).toBe(401)

    expect(await ask(owner, { type: 'pending_devices' })).toEqual({ type: 'pending_devices', devices: [{ id, name: 'laptop' }] })
    expect(await ask(owner, { type: 'approve_device', id })).toEqual({ type: 'device_approved', id, name: 'laptop' })
    expect((await upgrade(DEVICE_TOKEN)).status).toBe(101)
  })

  it('a spent or unknown setup code answers 401 and a bad body 400', async () => {
    await start()
    const owner = (await upgrade(OWNER_TOKEN)).socket!
    const { code } = await ask(owner, { type: 'pair_code' })
    expect((await pair({ code, name: 'a', token: DEVICE_TOKEN })).status).toBe(202)
    expect((await pair({ code, name: 'b', token: DEVICE_TOKEN })).status).toBe(401)
    expect((await pair({ code: 'ffffffffffff', name: 'b', token: DEVICE_TOKEN })).status).toBe(401)
    expect((await pair({ code: 1 })).status).toBe(400)
    expect((await fetch(`http://${base()}/control/pair`)).status).toBe(405)
  })

  it('a device socket cannot issue a code or approve a device', async () => {
    await start()
    const owner = (await upgrade(OWNER_TOKEN)).socket!
    const { code } = await ask(owner, { type: 'pair_code' })
    const { id } = (await (await pair({ code, name: 'laptop', token: DEVICE_TOKEN })).json()) as { id: string }
    await ask(owner, { type: 'approve_device', id })

    const device = (await upgrade(DEVICE_TOKEN)).socket!
    expect(await ask(device, { type: 'pair_code' })).toEqual({ type: 'error', code: 'forbidden' })
    expect(await ask(device, { type: 'approve_device', id })).toEqual({ type: 'error', code: 'forbidden' })
  })

  it('an unknown token is still refused 401', async () => {
    await start()
    expect((await upgrade('some-other-token-that-is-long-enough-99')).status).toBe(401)
  })
})
