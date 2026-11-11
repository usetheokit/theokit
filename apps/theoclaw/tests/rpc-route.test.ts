import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { adminRpcFor } from '../src/control-plane/control-wiring.js'
import { createDevicePairing } from '../src/control-plane/device-pairing.js'
import { serveHandler } from '../src/control-plane/http-dispatch.js'

const TOKEN = 'owner-token-that-is-long-enough-000001'
const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function setup(env: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'theoclaw-rpc-'))
  dirs.push(dir)
  const devices = createDevicePairing({ dir })
  const router = async (): Promise<Response> => new Response('router', { status: 404 })
  return {
    devices,
    handler: serveHandler(
      router,
      undefined,
      devices,
      undefined,
      undefined,
      undefined,
      adminRpcFor(env, TOKEN, devices),
    ),
  }
}
const call = (path: string, token?: string, init: RequestInit = {}): Request =>
  new Request(`http://x${path}`, {
    ...init,
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  })

describe('admin HTTP RPC', () => {
  it('is off unless enabled', async () => {
    const { handler } = setup({})
    expect((await handler(call('/rpc/pending_devices', TOKEN))).status).toBe(404)
  })

  it('needs the bearer token and lists the pending devices', async () => {
    const { handler, devices } = setup({ THEOCLAW_ADMIN_HTTP_RPC: '1' })
    expect((await handler(call('/rpc/pending_devices'))).status).toBe(401)
    expect((await handler(call('/rpc/pending_devices', 'wrong'))).status).toBe(401)
    const requested = devices.request(
      devices.issueSetupCode(),
      'laptop',
      'device-token-that-is-long-enough-0001',
    )
    if (!requested.ok) throw new Error('refused')
    const response = await handler(call('/rpc/pending_devices', TOKEN))
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      ok: boolean
      payload: { devices: { name: string }[] }
    }
    expect(body.ok).toBe(true)
    expect(body.payload.devices.map((d) => d.name)).toEqual(['laptop'])
    const approved = await handler(
      call('/rpc/approve_device', TOKEN, {
        method: 'POST',
        body: JSON.stringify({ id: requested.id }),
      }),
    )
    expect(approved.status).toBe(200)
  })

  it('refuses a method it does not expose', async () => {
    const { handler } = setup({ THEOCLAW_ADMIN_HTTP_RPC: '1' })
    expect((await handler(call('/rpc/secrets.store.get', TOKEN))).status).toBe(400)
  })

  it('issues a pair code over POST only, and answers 405 for the wrong verb', async () => {
    const { handler } = setup({ THEOCLAW_ADMIN_HTTP_RPC: '1' })
    const issued = await handler(call('/rpc/pair_code', TOKEN, { method: 'POST' }))
    expect(issued.status).toBe(200)
    expect(((await issued.json()) as { payload: { code: string } }).payload.code).toBeTruthy()
    expect((await handler(call('/rpc/pair_code', TOKEN))).status).toBe(405)
    expect((await handler(call('/rpc/pending_devices', TOKEN, { method: 'POST' }))).status).toBe(405)
    expect((await handler(call('/rpc/pending_devices', TOKEN, { method: 'DELETE' }))).status).toBe(405)
  })

  it('refuses approve_device with a missing or unknown id', async () => {
    const { handler } = setup({ THEOCLAW_ADMIN_HTTP_RPC: '1' })
    expect((await handler(call('/rpc/approve_device', TOKEN, { method: 'POST' }))).status).toBe(400)
    const unknown = await handler(call('/rpc/approve_device', TOKEN, { method: 'POST', body: JSON.stringify({ id: 'nope' }) }))
    expect(unknown.status).toBe(400)
  })

  it('answers 400, not 500, for a malformed path', async () => {
    const { handler } = setup({ THEOCLAW_ADMIN_HTTP_RPC: '1' })
    expect((await handler(call('/rpc/%E0%A4%A', TOKEN))).status).toBe(400)
  })
})
