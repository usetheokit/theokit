import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAppHost } from '../../src/app-host/index.js'

afterEach(() => vi.useRealTimers())

describe('app host stop timeout', () => {
  it('names the stop that never settles and skips the rest', async () => {
    vi.useFakeTimers()
    const stopA = vi.fn()
    const host = createAppHost({ stopTimeoutMs: 500 })
    host.service('A', () => 1, stopA)
    host.service(
      'B',
      () => 1,
      () => new Promise<void>(() => {}),
    )
    await host.start()
    const closing = host.close()
    await vi.advanceTimersByTimeAsync(500)
    expect(await closing).toEqual({ ok: false, failed: [], timedOut: ['B', 'A'] })
    await vi.advanceTimersByTimeAsync(1000)
    expect(stopA).not.toHaveBeenCalled()
  })
})
