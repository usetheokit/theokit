import { describe, expect, it, vi } from 'vitest'

import { createInProcessThreadRunRegistry } from '../../packages/theo/src/server/agent/thread-run-registry.js'

/**
 * M39 (ADR-0048) — the in-process thread→run registry. Pure state over the M37
 * durable transport: one active run per thread (sessionId), FIFO follow-up queue,
 * and next-run waiters (for subscribe-then-post). No transport, no LLM — unit.
 */

describe('M39 — thread-run-registry', () => {
  it('a fresh thread is idle (no active run)', () => {
    const r = createInProcessThreadRunRegistry()
    expect(r.getActive('s1')).toBeNull()
  })

  it('startRun marks the thread active; endRun clears it (matching runId)', () => {
    const r = createInProcessThreadRunRegistry()
    r.startRun('s1', 'run-a')
    expect(r.getActive('s1')).toBe('run-a')
    const next = r.endRun('s1', 'run-a')
    expect(next).toBeUndefined() // empty queue
    expect(r.getActive('s1')).toBeNull()
  })

  it('threads are isolated by sessionId', () => {
    const r = createInProcessThreadRunRegistry()
    r.startRun('s1', 'run-a')
    expect(r.getActive('s2')).toBeNull()
  })

  it('queued follow-ups drain FIFO on endRun', () => {
    const r = createInProcessThreadRunRegistry()
    r.startRun('s1', 'run-a')
    r.queue('s1', { message: 'first' })
    r.queue('s1', { message: 'second' })
    // Ending the active run hands back the head of the queue (FIFO).
    expect(r.endRun('s1', 'run-a')).toEqual({ message: 'first' })
    // The dispatcher would startRun the continuation; simulate that + end again.
    r.startRun('s1', 'run-b')
    expect(r.endRun('s1', 'run-b')).toEqual({ message: 'second' })
    r.startRun('s1', 'run-c')
    expect(r.endRun('s1', 'run-c')).toBeUndefined() // drained
  })

  it('onNextRun waiters fire once when a run starts, then are cleared', () => {
    const r = createInProcessThreadRunRegistry()
    const cb = vi.fn()
    r.onNextRun('s1', cb)
    r.startRun('s1', 'run-a')
    expect(cb).toHaveBeenCalledExactlyOnceWith('run-a')
    // A second run does NOT re-fire the (one-shot) waiter.
    r.endRun('s1', 'run-a')
    r.startRun('s1', 'run-b')
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('onNextRun returns an unsubscribe that prevents the callback', () => {
    const r = createInProcessThreadRunRegistry()
    const cb = vi.fn()
    const off = r.onNextRun('s1', cb)
    off()
    r.startRun('s1', 'run-a')
    expect(cb).not.toHaveBeenCalled()
  })

  it('endRun with a non-matching runId is a no-op (stale terminal does not clear a newer run)', () => {
    const r = createInProcessThreadRunRegistry()
    r.startRun('s1', 'run-a')
    expect(r.endRun('s1', 'run-stale')).toBeUndefined()
    expect(r.getActive('s1')).toBe('run-a') // still active
  })
})
