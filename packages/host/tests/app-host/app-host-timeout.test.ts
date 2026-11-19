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

  it('reports timed-out rollback stops in rollbackFailures', async () => {
    vi.useFakeTimers()
    const host = createAppHost({ stopTimeoutMs: 500 })
    host.service(
      'A',
      () => 1,
      () => new Promise<void>(() => {}),
    )
    host.service('B', () => {
      throw new Error('boom')
    })
    const started = host.start().catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(500)
    const error = (await started) as { rollbackFailures: { step: string }[] }
    expect(error.rollbackFailures.map((f) => f.step)).toEqual(['A'])
  })

  it('keeps the close result stable when a timed-out stop rejects later', async () => {
    vi.useFakeTimers()
    const host = createAppHost({ stopTimeoutMs: 500 })
    host.service(
      'A',
      () => 1,
      () => new Promise<void>((_, reject) => setTimeout(() => reject(new Error('late')), 800)),
    )
    await host.start()
    const closing = host.close()
    await vi.advanceTimersByTimeAsync(500)
    const result = await closing
    await vi.advanceTimersByTimeAsync(1000)
    expect(result).toEqual({ ok: false, failed: [], timedOut: ['A'] })
  })
})
