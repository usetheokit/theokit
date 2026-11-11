import { describe, expect, it } from 'vitest'

import type { DevicePairing } from '../src/control-plane/device-pairing.js'
import { rpcRoute } from '../src/control-plane/rpc-route.js'

const TOKEN = 't'.repeat(32)
const devices = { pending: () => [{ id: 'a', name: 'phone' }] } as unknown as DevicePairing
const call = (path: string, auth?: string) =>
  rpcRoute(
    TOKEN,
    devices,
  )(new Request(`http://x${path}`, { headers: auth === undefined ? {} : { authorization: auth } }))

describe('rpc route', () => {
  it('lists pending devices with the token', async () => {
    const res = await call('/rpc/pending_devices', `Bearer ${TOKEN}`)
    expect(res?.status).toBe(200)
    expect(await res?.json()).toEqual({ ok: true, devices: [{ id: 'a', name: 'phone' }] })
  })
  it('refuses without the token', async () => {
    expect((await call('/rpc/pending_devices'))?.status).toBe(401)
  })
  it('refuses an unsupported method', async () => {
    expect((await call('/rpc/secrets.store.get', `Bearer ${TOKEN}`))?.status).toBe(400)
  })
  it('ignores other paths', async () => {
    expect(await call('/other')).toBeUndefined()
  })
})
