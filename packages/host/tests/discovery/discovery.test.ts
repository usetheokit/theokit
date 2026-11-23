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
    const name = 'é'.repeat(40) + '😀'.repeat(10) // 80 + 40 bytes
    const result = announceService({ type: 'x', name, port: 1, host: '10.0.0.1', publisher })
    expect(result.name).toBeDefined()
    expect(Buffer.byteLength(result.name!)).toBeLessThanOrEqual(63)
    expect(name.startsWith(result.name!)).toBe(true)
    expect(result.name).not.toContain('�')
    expect(Array.from(result.name!).every((c) => c === 'é' || c === '😀')).toBe(true)
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
