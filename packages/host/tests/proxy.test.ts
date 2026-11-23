import * as http from 'node:http'
import * as net from 'node:net'
import type { AddressInfo } from 'node:net'
import type { Duplex } from 'node:stream'
import { getGlobalDispatcher, setGlobalDispatcher } from 'undici'
import { afterEach, describe, expect, it } from 'vitest'
import { applyOutboundProxy, validateProxy } from '../src/proxy.js'

const servers: http.Server[] = []
const sockets = new Set<Duplex>()
const original = getGlobalDispatcher()

afterEach(async () => {
  for (const socket of sockets) socket.destroy()
  sockets.clear()
  const installed = getGlobalDispatcher()
  setGlobalDispatcher(original)
  if (installed !== original) await installed.destroy()
  await Promise.all(
    servers.splice(0).map(
      (s) =>
        new Promise((r) => {
          s.closeAllConnections()
          s.close(r)
        }),
    ),
  )
})

async function listen(server: http.Server): Promise<string> {
  servers.push(server)
  server.on('connection', (socket) => sockets.add(socket))
  server.on('connect', (_req, socket) => sockets.add(socket))
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

describe('applyOutboundProxy', () => {
  it('routes global fetch through the proxy', async () => {
    const target = http.createServer((_req, res) => res.end('via-proxy'))
    const targetUrl = await listen(target)
    const connects: string[] = []
    const proxy = http.createServer()
    proxy.on('connect', (req, socket) => {
      connects.push(req.url ?? '')
      const upstream = net.connect(Number(new URL(targetUrl).port), '127.0.0.1', () => {
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        upstream.pipe(socket)
        socket.pipe(upstream)
      })
      sockets.add(upstream)
    })
    const url = await listen(proxy)
    expect(applyOutboundProxy({ MY_PROXY: url }, { variable: 'MY_PROXY' })).toEqual({
      installed: true,
    })
    const res = await fetch('http://example.invalid:8080/hello')
    expect(await res.text()).toBe('via-proxy')
    expect(connects).toEqual(['example.invalid:8080'])
  })

  it('installs nothing when the variable is unset', () => {
    expect(applyOutboundProxy({}, { variable: 'MY_PROXY' })).toEqual({ installed: false })
    expect(applyOutboundProxy({ MY_PROXY: '  ' }, { variable: 'MY_PROXY' })).toEqual({
      installed: false,
    })
    expect(getGlobalDispatcher()).toBe(original)
  })
})

describe('validateProxy', () => {
  it('succeeds when the proxy accepts CONNECT', async () => {
    const proxy = http.createServer()
    proxy.on('connect', (_req, socket) =>
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'),
    )
    const url = await listen(proxy)
    expect(await validateProxy(url, { target: 'example.com:443' })).toEqual({
      ok: true,
      statusCode: 200,
    })
  })

  it('returns a typed failure when the proxy refuses CONNECT', async () => {
    const proxy = http.createServer()
    proxy.on('connect', (_req, socket) => socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'))
    const url = await listen(proxy)
    const result = await validateProxy(url, { target: 'example.com:443' })
    expect(result).toMatchObject({ ok: false, reason: 'connect_refused', statusCode: 403 })
  })

  it('times out when the proxy never answers', async () => {
    const proxy = http.createServer()
    proxy.on('connect', () => {})
    const url = await listen(proxy)
    const result = await validateProxy(url, { target: 'example.com:443', timeoutMs: 50 })
    expect(result).toMatchObject({ ok: false, reason: 'timeout' })
  })

  it('reports an unreachable proxy and a bad URL', async () => {
    const url = await listen(http.createServer())
    await new Promise((r) => {
      servers[0]!.close(r)
    })
    expect(await validateProxy(url, { target: 'a:1' })).toMatchObject({
      ok: false,
      reason: 'connection_error',
    })
    expect(await validateProxy('nope', { target: 'a:1' })).toMatchObject({
      ok: false,
      reason: 'invalid_proxy_url',
    })
  })
})
