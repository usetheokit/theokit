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

  it('with attachSignalsEarly a SIGTERM before start() has run still tears down', async () => {
    const signals = new EventEmitter()
    const exit = vi.fn()
    const stop = vi.fn()
    const host = createAppHost({ signals, exit, attachSignalsEarly: true })
    host.service('A', () => 1, stop)
    expect(signals.listenerCount('SIGTERM')).toBe(1)
    const started = host.start()
    signals.emit('SIGTERM')
    await started
    await tick()
    expect(stop).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledExactlyOnceWith(0)
    expect(signals.listenerCount('SIGTERM')).toBe(0)
  })

  it('does not attach before start() by default', () => {
    const signals = new EventEmitter()
    createAppHost({ signals })
    expect(signals.listenerCount('SIGINT')).toBe(0)
  })

  it('detachSignals stops reacting without stopping anything, and is idempotent', async () => {
    const signals = new EventEmitter()
    const exit = vi.fn()
    const stop = vi.fn()
    const host = createAppHost({ signals, exit, attachSignalsEarly: true })
    host.service('A', () => 1, stop)
    await host.start()
    host.detachSignals()
    host.detachSignals()
    signals.emit('SIGINT')
    await tick()
    expect(stop).not.toHaveBeenCalled()
    expect(exit).not.toHaveBeenCalled()
    expect(signals.listenerCount('SIGINT')).toBe(0)
  })

  it('detachSignals before a scheduled start keeps the listeners off', async () => {
    const signals = new EventEmitter()
    const host = createAppHost({ signals })
    const started = host.start()
    host.detachSignals()
    await started
    expect(signals.listenerCount('SIGTERM')).toBe(0)
  })

  it('names the signal of a repeated one', async () => {
    const signals = new EventEmitter()
    const onError = vi.fn()
    const host = createAppHost({ signals, onError })
    host.service(
      'A',
      () => 1,
      () => new Promise<void>(() => undefined),
    )
    await host.start()
    signals.emit('SIGTERM')
    await tick()
    signals.emit('SIGINT')
    expect(onError).toHaveBeenCalledExactlyOnceWith('signal', expect.any(Error), {
      signal: 'SIGINT',
    })
  })
})
