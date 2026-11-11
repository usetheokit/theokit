import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'

import { installProxyFromEnv } from '../src/ops/proxy-dispatcher.js'
import { runCli } from '../src/cli.js'
import { cleanScratch, harness } from './support/cli-harness.js'

afterEach(cleanScratch)

describe('theoclaw proxy', () => {
  it('validate fails with no proxy configured', async () => {
    const h = harness()
    expect(await runCli(['proxy', 'validate'], h.io)).toBe(1)
    expect(h.stderr()).toContain('proxy validation requires')
  })

  it('captures what goes through the capture proxy, and validate reaches it', async () => {
    const origin = createServer((_req, res) => res.end('ok'))
    await new Promise<void>((r) => origin.listen(0, '127.0.0.1', r))
    const originPort = (origin.address() as AddressInfo).port
    const h = harness()
    const stop: Array<() => void> = []
    const io = { ...h.io, signals: { ...h.signals, on: (_s: string, l: () => void) => stop.push(l) } } as unknown as typeof h.io
    const running = runCli(['proxy', 'start'], io)
    let url = ''
    for (let i = 0; i < 200 && !url; i++) {
      url = /Debug proxy: (\S+)/.exec(h.stdout())?.[1] ?? ''
      await new Promise((r) => setTimeout(r, 10))
    }
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(await runCli(['proxy', 'validate', '--proxy-url', url, '--target', `127.0.0.1:${originPort}`], h.io)).toBe(0)
    expect(h.stdout()).toContain('reachable')
    // A turn's provider request: the global fetch, once THEOCLAW_PROXY_URL is installed, goes through the proxy.
    expect(installProxyFromEnv({ THEOCLAW_PROXY_URL: url })).toBe(true)
    await fetch('http://provider.invalid/v1/messages').catch(() => undefined)
    stop.forEach((l) => l())
    expect(await running).toBe(0)
    const h2 = { ...h.io, env: h.io.env }
    expect(await runCli(['proxy', 'captures'], h2)).toBe(0)
    expect(h.stdout()).toContain('provider.invalid')
    expect(h.stdout()).toContain(`CONNECT 127.0.0.1:${originPort}`)
    origin.close()
  })
})
