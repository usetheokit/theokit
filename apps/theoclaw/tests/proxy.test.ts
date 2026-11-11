import http from 'node:http'
import net from 'node:net'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { runCli } from '../src/cli.js'
import { readCaptures, startCaptureProxy, validateProxy } from '../src/ops/proxy.js'
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
      const result = await validateProxy(`http://127.0.0.1:${port(proxy)}`, target)
      expect(result.ok).toBe(true)
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

  it('validate reports an unreachable proxy', async () => {
    expect((await validateProxy('http://127.0.0.1:1', 'a:443')).ok).toBe(false)
    expect((await validateProxy('nonsense', 'a:443')).ok).toBe(false)
  })
})
