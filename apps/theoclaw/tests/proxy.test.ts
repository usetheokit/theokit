import http from 'node:http'
import net from 'node:net'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { getGlobalDispatcher, setGlobalDispatcher } from 'undici'
import { afterEach, describe, expect, it } from 'vitest'

import { runCli } from '../src/cli.js'
import { applyProxyEnvironment, readCaptures, startCaptureProxy } from '../src/ops/proxy.js'
import { cleanScratch, harness } from './support/cli-harness.js'

afterEach(cleanScratch)
const port = (s: net.Server): number => (s.address() as net.AddressInfo).port

describe('theoclaw proxy', () => {
  it('validate fails without a configured proxy', async () => {
    const v = harness()
    expect(await runCli(['proxy', 'validate'], { ...v.io, env: {} })).toBe(1)
    expect(v.stdout()).toContain('requires')
  })

  it('validate reaches a capture proxy, which lists the tunnel it carried', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'proxy-'))
    const file = join(dir, 'c', 'captures.jsonl')
    const origin = net.createServer((s) => s.end()).listen(0, '127.0.0.1')
    await new Promise((r) => origin.once('listening', r))
    const proxy = await startCaptureProxy(file, 0)
    try {
      const target = `127.0.0.1:${port(origin)}`
      const v = harness()
      const code = await runCli(['proxy', 'validate', '--proxy-url', `http://127.0.0.1:${port(proxy)}`, '--target', target], { ...v.io, env: {} })
      expect(code).toBe(0)
      expect(v.stdout()).toContain('ok:')
      expect(readCaptures(file).map((c) => `${c.method} ${c.target}`)).toEqual([`CONNECT ${target}`])
    } finally {
      proxy.close()
      origin.close()
    }
  })

  it('forwards and records a plain HTTP request', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'proxy-'))
    const file = join(dir, 'captures.jsonl')
    const origin = http.createServer((_q, r) => r.end('hi')).listen(0, '127.0.0.1')
    await new Promise((r) => origin.once('listening', r))
    const proxy = await startCaptureProxy(file, 0)
    try {
      const body = await new Promise<string>((resolve) =>
        http.get({ host: '127.0.0.1', port: port(proxy), path: `http://127.0.0.1:${port(origin)}/v1/x` }, (res) => {
          let t = ''
          res.on('data', (d) => (t += d))
          res.on('end', () => resolve(t))
        }),
      )
      expect(body).toBe('hi')
      expect(readCaptures(file)[0]?.target).toBe(`127.0.0.1:${port(origin)}/v1/x`)
    } finally {
      proxy.close()
      origin.close()
    }
  })

  it('refuses to forward a non-http URL', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'proxy-')), 'captures.jsonl')
    const proxy = await startCaptureProxy(file, 0)
    try {
      const status = await new Promise<number>((resolve) =>
        http.get({ host: '127.0.0.1', port: port(proxy), path: 'ftp://127.0.0.1/x' }, (res) => {
          res.resume()
          resolve(res.statusCode ?? 0)
        }),
      )
      expect(status).toBe(400)
      expect(readCaptures(file)).toHaveLength(0)
    } finally {
      proxy.close()
    }
  })

  it('validate sends Proxy-Authorization from the URL user info without printing it', async () => {
    const seen: Array<string | undefined> = []
    const auth = http.createServer()
    auth.on('connect', (req, socket) => {
      seen.push(req.headers['proxy-authorization'])
      socket.end(
        req.headers['proxy-authorization'] === `Basic ${Buffer.from('user:pass').toString('base64')}`
          ? 'HTTP/1.1 200 OK\r\n\r\n'
          : 'HTTP/1.1 407 Proxy Authentication Required\r\n\r\n',
      )
    })
    await new Promise<void>((r) => auth.listen(0, '127.0.0.1', r))
    try {
      const v = harness()
      const code = await runCli(['proxy', 'validate', '--proxy-url', `http://user:pass@127.0.0.1:${port(auth)}`], { ...v.io, env: {} }) // trufflehog:ignore -- fake proxy credential for a local test proxy
      expect(code).toBe(0)
      expect(v.stdout()).not.toContain('pass')
      const bad = harness()
      expect(await runCli(['proxy', 'validate', '--proxy-url', `http://127.0.0.1:${port(auth)}`], { ...bad.io, env: {} })).toBe(1)
      expect(bad.stdout()).toContain('failed:')
      expect(seen[1]).toBeUndefined()
    } finally {
      auth.close()
    }
  })

  it('validate reports an unreachable or invalid proxy', async () => {
    for (const url of ['http://127.0.0.1:1', 'nonsense']) {
      const v = harness()
      expect(await runCli(['proxy', 'validate', '--proxy-url', url], { ...v.io, env: {} })).toBe(1)
      expect(v.stdout()).toContain('failed:')
    }
  })
})

describe('applyProxyEnvironment', () => {
  it('prefers the debug proxy, falls back when it is blank, and does nothing when unset', () => {
    const before = getGlobalDispatcher()
    try {
      expect(applyProxyEnvironment({})).toBeUndefined()
      expect(applyProxyEnvironment({ THEOCLAW_PROXY_URL: ' http://127.0.0.1:1 ' })).toBe('http://127.0.0.1:1')
      expect(applyProxyEnvironment({ THEOCLAW_DEBUG_PROXY_URL: 'http://127.0.0.1:2', THEOCLAW_PROXY_URL: 'http://127.0.0.1:1' })).toBe('http://127.0.0.1:2')
      expect(applyProxyEnvironment({ THEOCLAW_DEBUG_PROXY_URL: '  ', THEOCLAW_PROXY_URL: 'http://127.0.0.1:1' })).toBe('http://127.0.0.1:1')
    } finally {
      setGlobalDispatcher(before)
    }
  })
})
