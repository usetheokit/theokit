/**
 * M4 (theokit-ai-first) — the in-process approval registry: the pending-approval store the HITL
 * plugin's `awaitApproval` uses and the approve route resolves. `register(id)` returns a Promise
 * the SDK run awaits (the pause); `resolve(id, approved)` settles it; a timeout settles it per
 * `onTimeout`. Single-process contract (a durable impl slots in via the same interface).
 */
import { describe, expect, it, vi } from 'vitest'

import { createInProcessApprovalRegistry } from '../../packages/theo/src/server/agent/approval-registry.js'

describe('createInProcessApprovalRegistry (M4)', () => {
  it('test_register_resolves_true_on_approve', async () => {
    const reg = createInProcessApprovalRegistry()
    const pending = reg.register('a1', { timeoutMs: 10_000, onTimeout: 'abort' })
    expect(reg.resolve('a1', true)).toBe(true)
    await expect(pending).resolves.toBe(true)
  })

  it('test_register_resolves_false_on_deny', async () => {
    const reg = createInProcessApprovalRegistry()
    const pending = reg.register('a2', { timeoutMs: 10_000, onTimeout: 'abort' })
    reg.resolve('a2', false)
    await expect(pending).resolves.toBe(false)
  })

  it('test_resolve_unknown_id_returns_false', () => {
    const reg = createInProcessApprovalRegistry()
    expect(reg.resolve('nope', true)).toBe(false)
  })

  it('test_resolve_twice_is_a_noop_second_time', async () => {
    const reg = createInProcessApprovalRegistry()
    const pending = reg.register('a3', { timeoutMs: 10_000, onTimeout: 'abort' })
    expect(reg.resolve('a3', true)).toBe(true)
    expect(reg.resolve('a3', false)).toBe(false) // already settled/removed
    await expect(pending).resolves.toBe(true)
  })

  it('test_times_out_per_onTimeout_abort_denies', async () => {
    vi.useFakeTimers()
    try {
      const reg = createInProcessApprovalRegistry()
      const pending = reg.register('a4', { timeoutMs: 1000, onTimeout: 'abort' })
      vi.advanceTimersByTime(1001)
      await expect(pending).resolves.toBe(false) // abort → deny
    } finally {
      vi.useRealTimers()
    }
  })

  it('test_times_out_per_onTimeout_proceed_approves', async () => {
    vi.useFakeTimers()
    try {
      const reg = createInProcessApprovalRegistry()
      const pending = reg.register('a5', { timeoutMs: 1000, onTimeout: 'proceed' })
      vi.advanceTimersByTime(1001)
      await expect(pending).resolves.toBe(true) // proceed → approve
    } finally {
      vi.useRealTimers()
    }
  })

  it('test_two_pending_approvals_resolve_independently', async () => {
    const reg = createInProcessApprovalRegistry()
    const p1 = reg.register('x1', { timeoutMs: 10_000, onTimeout: 'abort' })
    const p2 = reg.register('x2', { timeoutMs: 10_000, onTimeout: 'abort' })
    reg.resolve('x1', true)
    // x2 is still pending; resolving x1 does not settle x2.
    reg.resolve('x2', false)
    await expect(p1).resolves.toBe(true)
    await expect(p2).resolves.toBe(false)
  })
})
