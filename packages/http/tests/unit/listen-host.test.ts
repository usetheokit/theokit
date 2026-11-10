import 'reflect-metadata'
import { describe, it, expect, vi } from 'vitest'
import { createNodeAdapter } from '../../src/bridge/runtime/node.js'
import { TheoApp } from '../../src/index.js'

describe('listen host binding', () => {
  it('node adapter binds loopback by default, not every interface', async () => {
    const h = createNodeAdapter().createServer(() => new Response('ok'))
    await new Promise<void>((r) => h.listen(0, r))
    const addr = (h as unknown as { address(): unknown }).address()
    expect(addr).toBeTruthy()
    await new Promise<void>((r) => h.close(r))
  })

  it('TheoApp.listen passes loopback host and logs the bound host', async () => {
    const calls: unknown[][] = []
    const app = Object.create(TheoApp.prototype) as TheoApp
    ;(app as unknown as { serverHandle: unknown }).serverHandle = {
      listen: (...a: unknown[]) => {
        calls.push(a)
        ;(a[1] as () => void)()
      },
    }
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await app.listen(4321)
    expect(calls[0]![2]).toBe('127.0.0.1')
    expect(log.mock.calls[0]![0]).toContain('127.0.0.1:4321')
    log.mockRestore()
  })

  it('node server really listens on 127.0.0.1', async () => {
    const net = await import('node:net')
    const orig = net.Server.prototype.listen
    const seen: unknown[][] = []
    net.Server.prototype.listen = function (this: unknown, ...a: unknown[]) {
      seen.push(a)
      return (orig as (...x: unknown[]) => unknown).apply(this, a)
    } as typeof orig
    try {
      const h = createNodeAdapter().createServer(() => new Response('ok'))
      await new Promise<void>((r) => h.listen(0, r))
      await new Promise<void>((r) => h.close(r))
    } finally {
      net.Server.prototype.listen = orig
    }
    expect(seen[0]).toContain('127.0.0.1')
  })
})
