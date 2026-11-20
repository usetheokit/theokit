import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { createAppHost } from '../../src/app-host/index.js'

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('app host signals', () => {
  it('closes and exits 0 on one SIGTERM, ignoring a second', async () => {
    const signals = new EventEmitter()
    const exit = vi.fn()
    const onError = vi.fn()
    let release!: () => void
    const stop = vi.fn(() => new Promise<void>((resolve) => (release = resolve)))
    const host = createAppHost({ signals, exit, onError })
    host.service('A', () => 1, stop)
    await host.start()
    signals.emit('SIGTERM')
    await tick()
    signals.emit('SIGTERM')
    expect(onError).toHaveBeenCalledTimes(1)
    release()
    await tick()
    expect(stop).toHaveBeenCalledTimes(1)
    expect(exit).toHaveBeenCalledExactlyOnceWith(0)
    expect(signals.listenerCount('SIGTERM')).toBe(0)
    expect(signals.listenerCount('SIGINT')).toBe(0)
  })

  it('exits 1 when a stop fails and still runs the others', async () => {
    const signals = new EventEmitter()
    const exit = vi.fn()
    const onError = vi.fn()
    const stopA = vi.fn()
    const host = createAppHost({ signals, exit, onError })
    host.service('A', () => 1, stopA)
    host.service(
      'B',
      () => 1,
      () => {
        throw new Error('bad')
      },
    )
    await host.start()
    signals.emit('SIGINT')
    await tick()
    expect(stopA).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledWith('B', expect.any(Error))
    expect(exit).toHaveBeenCalledExactlyOnceWith(1)
  })
})

describe('app host signal during failed start', () => {
  it('exits 1 when rollback fails and a signal overlaps it', async () => {
    const signals = new EventEmitter()
    const exit = vi.fn()
    const host = createAppHost({ signals, exit })
    host.service(
      'A',
      () => 1,
      () => {
        signals.emit('SIGTERM')
        throw new Error('stop failed')
      },
    )
    host.service('B', () => {
      throw new Error('start failed')
    })
    await expect(host.start()).rejects.toThrow()
    await tick()
    expect(exit).toHaveBeenCalledExactlyOnceWith(1)
  })

  it('stops a service whose start callback closes the host', async () => {
    const stop = vi.fn()
    const host = createAppHost()
    host.service(
      'A',
      () => {
        void host.close()
        return 1
      },
      stop,
    )
    await host.start()
    await host.close()
    expect(stop).toHaveBeenCalledOnce()
  })
})
