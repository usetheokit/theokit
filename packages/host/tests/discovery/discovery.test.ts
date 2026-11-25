import { describe, expect, it, vi } from 'vitest'

import { announceService, type ServicePublisher } from '../../src/discovery/index.js'

function fake(overrides: Partial<ServicePublisher> = {}): ServicePublisher {
  return {
    publish: vi.fn(),
    unpublishAll: vi.fn(() => Promise.resolve()),
    destroy: vi.fn(() => Promise.resolve()),
    ...overrides,
  }
}

describe('announceService', () => {
  it.each(['127.0.0.1', '127.1.2.3', 'localhost', '::1'])(
    'announces nothing on loopback %s',
    async (host) => {
      const publisher = fake()
      const result = announceService({ type: 'x', name: 'n', port: 1, host, publisher })
      expect(result.announced).toBe(false)
      expect(result.reason).toBe('loopback')
      expect(publisher.publish).not.toHaveBeenCalled()
      await result.stop()
      expect(publisher.destroy).not.toHaveBeenCalled()
    },
  )

  it('publishes on a non-loopback host', () => {
    const publisher = fake()
    const result = announceService({
      type: 'x',
      name: 'n',
      port: 9,
      txt: { a: 'b' },
      host: '192.168.1.5',
      publisher,
    })
    expect(result.announced).toBe(true)
    expect(publisher.publish).toHaveBeenCalledWith({
      name: 'n',
      type: 'x',
      port: 9,
      txt: { a: 'b' },
    })
  })

  it('trims a long name on a character boundary', () => {
    const publisher = fake()
    const name = '\u00e9'.repeat(40) + '\u{1f600}'.repeat(10) // 80 + 40 bytes
    const result = announceService({ type: 'x', name, port: 1, host: '10.0.0.1', publisher })
    expect(result.name).toBeDefined()
    expect(Buffer.byteLength(result.name!)).toBeLessThanOrEqual(63)
    expect(name.startsWith(result.name!)).toBe(true)
    expect(result.name).not.toContain('�')
    expect(Array.from(result.name!).every((c) => c === '\u00e9' || c === '\u{1f600}')).toBe(true)
  })

  it('stop resolves within its bound when the publisher never answers', async () => {
    vi.useFakeTimers()
    try {
      const never = (): Promise<void> => new Promise(() => {})
      const publisher = fake({ unpublishAll: never, destroy: never })
      const result = announceService({ type: 'x', name: 'n', port: 1, host: '10.0.0.1', publisher })
      let done = false
      const p = result.stop().then(() => {
        done = true
      })
      await vi.advanceTimersByTimeAsync(2100)
      await p
      expect(done).toBe(true)
      expect(result.stop()).toBe(result.stop())
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('announceService onError', () => {
  function subscribable(): {
    publisher: ServicePublisher
    emit: (error: unknown) => void
    order: string[]
  } {
    const listeners = new Set<(error: unknown) => void>()
    const order: string[] = []
    const publisher = fake({
      unpublishAll: vi.fn(() => {
        order.push('unpublishAll')
        return Promise.resolve()
      }),
      destroy: vi.fn(() => {
        order.push('destroy')
        return Promise.resolve()
      }),
      onError: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    })
    return { publisher, order, emit: (error) => listeners.forEach((listener) => listener(error)) }
  }

  it('stops the announcement, then reports the first failure once', async () => {
    const { publisher, emit, order } = subscribable()
    const onError = vi.fn((error: unknown) => order.push(`onError:${String(error)}`))
    announceService({ type: 'x', name: 'n', port: 1, host: '10.0.0.2', publisher, onError })
    emit('first')
    emit('second')
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1))
    expect(order).toEqual(['unpublishAll', 'destroy', 'onError:first'])
  })

  it('works with a publisher that has no error subscription', async () => {
    const publisher = fake()
    const result = announceService({
      type: 'x',
      name: 'n',
      port: 1,
      host: '10.0.0.2',
      publisher,
      onError: vi.fn(),
    })
    await result.stop()
    expect(publisher.destroy).toHaveBeenCalledTimes(1)
  })

  it('does not report after stop()', async () => {
    const { publisher, emit } = subscribable()
    const onError = vi.fn()
    const result = announceService({
      type: 'x',
      name: 'n',
      port: 1,
      host: '10.0.0.2',
      publisher,
      onError,
    })
    await result.stop()
    emit('late')
    await Promise.resolve()
    expect(onError).not.toHaveBeenCalled()
  })
})
