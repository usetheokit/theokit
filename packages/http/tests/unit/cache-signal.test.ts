import { describe, it, expect, vi } from 'vitest'
import { revalidateTag, revalidatePath, getRevalidationSignals } from '../../src/cache-signal.js'
import { runWithRequestContext } from '../../src/request-context.js'

function makeCtx() {
  return {
    request: new Request('http://localhost:3000/api/tasks'),
    pathname: '/api/tasks',
    method: 'POST',
    params: {},
    startedAt: Date.now(),
  }
}

describe('Cache Revalidation Signals', () => {
  it('test_revalidate_tag_emits_signal', async () => {
    await runWithRequestContext(makeCtx(), () => {
      revalidateTag('tasks')
      const signals = getRevalidationSignals()
      expect(signals).toHaveLength(1)
      expect(signals[0].kind).toBe('tag')
      expect(signals[0].value).toBe('tasks')
    })
  })

  it('test_revalidate_path_emits_signal', async () => {
    await runWithRequestContext(makeCtx(), () => {
      revalidatePath('/api/tasks')
      const signals = getRevalidationSignals()
      expect(signals).toHaveLength(1)
      expect(signals[0].kind).toBe('path')
      expect(signals[0].value).toBe('/api/tasks')
    })
  })

  it('test_multiple_tags_accumulated', async () => {
    await runWithRequestContext(makeCtx(), () => {
      revalidateTag('tasks')
      revalidateTag('users')
      revalidatePath('/api/dashboard')
      const signals = getRevalidationSignals()
      expect(signals).toHaveLength(3)
      expect(signals.map((s) => s.value)).toEqual(['tasks', 'users', '/api/dashboard'])
    })
  })

  it('test_signals_cleared_per_request', async () => {
    await runWithRequestContext(makeCtx(), () => {
      revalidateTag('tasks')
      expect(getRevalidationSignals()).toHaveLength(1)
    })

    // New request — signals should be clean
    await runWithRequestContext(makeCtx(), () => {
      expect(getRevalidationSignals()).toHaveLength(0)
    })
  })

  it('test_signals_outside_request_warns', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    revalidateTag('orphan')
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('outside a request context'))
    expect(getRevalidationSignals()).toHaveLength(0)
    spy.mockRestore()
  })

  it('test_signals_have_timestamp', async () => {
    await runWithRequestContext(makeCtx(), () => {
      const before = Date.now()
      revalidateTag('tasks')
      const signals = getRevalidationSignals()
      expect(signals[0].timestamp).toBeGreaterThanOrEqual(before)
      expect(signals[0].timestamp).toBeLessThanOrEqual(Date.now())
    })
  })
})
