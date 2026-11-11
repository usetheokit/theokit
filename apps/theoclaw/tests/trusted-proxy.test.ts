import { afterEach, describe, expect, it } from 'vitest'

import { type ControlPlaneHandle, listenControlPlane } from '../src/control-plane/listener.js'
import { readTrustedProxy } from '../src/control-plane/trusted-proxy.js'
import { createWebchatRoutes } from '../src/webchat/routes.js'

const TOKEN = 'webchat-token-value-0123456789abcdef'
const handles: ControlPlaneHandle[] = []
afterEach(async () => {
  for (const handle of handles.splice(0)) await handle.close()
})

async function serve(env: Record<string, string>, proxyOn = true): Promise<string> {
  const routes = createWebchatRoutes({
    token: TOKEN,
    assetsDir: '/nonexistent',
    turnFor: () => {
      throw new Error('no turn expected')
    },
    trustedProxy: proxyOn,
  })
  const trustedProxy = readTrustedProxy(env)
  const handle = await listenControlPlane({
    handler: routes,
    port: 0,
    host: '127.0.0.1',
    stderr: () => undefined,
    ...(trustedProxy === undefined ? {} : { trustedProxy }),
  })
  handles.push(handle)
  return `http://127.0.0.1:${handle.address().port}/webchat/chat`
}

// A post with no message: an accepted caller gets the generator's 400, a refused one 401.
const post = (url: string, headers: Record<string, string> = {}): Promise<Response> =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: '{}' })

describe('trusted-proxy mode', () => {
  it('accepts the identity header from an allowlisted peer without the token', async () => {
    const url = await serve({ THEOCLAW_TRUSTED_PROXY_HEADER: 'X-Remote-User', THEOCLAW_TRUSTED_PROXY_ADDRESSES: '127.0.0.1' })
    expect((await post(url)).status).toBe(401)
    expect((await post(url, { 'x-remote-user': 'alice' })).status).toBe(400)
    expect((await post(url, { 'x-theoclaw-trusted-identity': 'forged' })).status).toBe(401)
  })

  it('refuses the header from a peer that is not allowlisted', async () => {
    const url = await serve({ THEOCLAW_TRUSTED_PROXY_HEADER: 'x-remote-user', THEOCLAW_TRUSTED_PROXY_ADDRESSES: '10.9.9.9' })
    expect((await post(url, { 'x-remote-user': 'alice' })).status).toBe(401)
    expect((await post(url, { authorization: `Bearer ${TOKEN}` })).status).toBe(400)
  })

  it('is off unless configured', async () => {
    const url = await serve({}, false)
    expect((await post(url, { 'x-remote-user': 'alice' })).status).toBe(401)
  })

  it('needs both settings', () => {
    expect(() => readTrustedProxy({ THEOCLAW_TRUSTED_PROXY_HEADER: 'x-u' })).toThrow(/ADDRESSES/)
    expect(() => readTrustedProxy({ THEOCLAW_TRUSTED_PROXY_ADDRESSES: '1.2.3.4' })).toThrow(/HEADER/)
  })
})
