/**
 * An approval that expired is not a human pressing Deny (usetheokit/theokit#393).
 *
 * The two outcomes were byte-identical on the wire: `Tool 'send_email' denied by human approver`,
 * for both an explicit deny with no reason and a window that closed with nobody watching. The
 * framework did not merely fail to say what went wrong — it asserted something else went right,
 * namely that an approver decided.
 *
 * That is the distinction a HITL gate exists to record, so an operator auditing a gated action can
 * tell "a reviewer refused this" from "nobody was watching".
 *
 * The registry already held every value the message needs — `timeoutMs`, `onTimeout`, `expiresAt`.
 * None of it survived the settle.
 */
import { describe, expect, it, vi } from 'vitest'

import { createInProcessApprovalRegistry } from '../../packages/theo/src/server/agent/approval-registry.js'

describe('a timed-out approval says so (#393)', () => {
  it('marks the settle as a timeout, not as a decision', async () => {
    vi.useFakeTimers()
    try {
      const reg = createInProcessApprovalRegistry()
      const pending = reg.register('t1', { timeoutMs: 2000, onTimeout: 'abort' })
      vi.advanceTimersByTime(2001)

      const decision = await pending
      expect(decision.approved).toBe(false)
      expect(decision.settledBy).toBe('timeout')
    } finally {
      vi.useRealTimers()
    }
  })

  it('names the budget and the configured action in the reason', async () => {
    vi.useFakeTimers()
    try {
      const reg = createInProcessApprovalRegistry()
      const pending = reg.register('t2', { timeoutMs: 2000, onTimeout: 'abort' })
      vi.advanceTimersByTime(2001)

      const { reason } = await pending
      // The two facts an operator needs to act: how long the window was, and which of the three
      // configured actions applied. Neither is inferable from "denied by human approver".
      expect(reason).toContain('2000')
      expect(reason).toContain('abort')
    } finally {
      vi.useRealTimers()
    }
  })

  it("distinguishes 'retry' from 'abort', which both deny", async () => {
    // The registry's own comment says it implements no retry semantics — a timed-out 'retry' is a
    // deny, not a re-prompt. Three configurations collapsed into one sentence; the operator who
    // wrote `onTimeout: 'retry'` and got a denial had nothing to read that mentioned retry.
    vi.useFakeTimers()
    try {
      const reg = createInProcessApprovalRegistry()
      const pending = reg.register('t3', { timeoutMs: 500, onTimeout: 'retry' })
      vi.advanceTimersByTime(501)

      expect((await pending).reason).toContain('retry')
    } finally {
      vi.useRealTimers()
    }
  })

  it('leaves a human decision unmarked, so the two cannot be confused', async () => {
    const reg = createInProcessApprovalRegistry()
    const pending = reg.register('t4', { timeoutMs: 10_000, onTimeout: 'abort' })
    reg.resolve('t4', { approved: false })

    const decision = await pending
    expect(decision.settledBy).toBeUndefined()
  })

  it('marks an auto-approval too, so a proceed-on-timeout is auditable', async () => {
    // `onTimeout: 'proceed'` allows the tool BECAUSE nobody answered. Recording that as an
    // unmarked approval would claim a reviewer approved it, which is the same fabrication as the
    // denial case with the opposite sign — and the more dangerous of the two.
    vi.useFakeTimers()
    try {
      const reg = createInProcessApprovalRegistry()
      const pending = reg.register('t5', { timeoutMs: 300, onTimeout: 'proceed' })
      vi.advanceTimersByTime(301)

      const decision = await pending
      expect(decision.approved).toBe(true)
      expect(decision.settledBy).toBe('timeout')
    } finally {
      vi.useRealTimers()
    }
  })
})
