/**
 * B-040 — a failed hook approval leaves the gate open and says so.
 */
import { describe, expect, it, vi } from 'vitest'

import { applyHookDecision } from '../../src/consent/hook-decision.js'

const head = { spec: { command: 'echo hi' }, fingerprint: 'sha256:abc' }

function deps(over: Partial<Parameters<typeof applyHookDecision>[3]> = {}) {
  return {
    approve: vi.fn(() => Promise.resolve()),
    refuse: vi.fn(),
    markReviewed: vi.fn(),
    toast: vi.fn(),
    ...over,
  }
}

describe('B-040 — the consent gate closes only when the approval landed', () => {
  it('test_a_successful_approval_of_the_last_hook_closes_the_gate', async () => {
    // Anti-vacuity floor: never closing would satisfy the assertion below and break the product.
    const d = deps()
    await applyHookDecision('yes', head, 1, d)

    expect(d.markReviewed).toHaveBeenCalled()
    expect(d.toast).not.toHaveBeenCalled()
  })

  it('test_a_failed_approval_of_the_last_hook_leaves_the_gate_open', async () => {
    const d = deps({ approve: vi.fn(() => Promise.reject(new Error('EROFS'))) })

    await applyHookDecision('yes', head, 1, d)

    expect(
      d.markReviewed,
      'the gate closed as if the approval had succeeded, so the user is never asked again this ' +
        'session and the hook is not approved',
    ).not.toHaveBeenCalled()
    expect(d.toast, 'the failure was reported only to a log file').toHaveBeenCalled()
  })

  it('test_a_failed_approval_is_not_the_last_word_when_more_are_pending', async () => {
    const d = deps({ approve: vi.fn(() => Promise.reject(new Error('EROFS'))) })

    await applyHookDecision('yes', head, 3, d)

    expect(d.markReviewed).not.toHaveBeenCalled()
    expect(d.toast).toHaveBeenCalled()
  })

  it('test_declining_the_last_hook_still_closes_the_gate', () => {
    // Declining is a local state change with nothing to persist, so it cannot fail.
    const d = deps()
    return applyHookDecision('no', head, 1, d).then(() => {
      expect(d.refuse).toHaveBeenCalledWith('sha256:abc')
      expect(d.markReviewed).toHaveBeenCalled()
    })
  })

  it('test_approval_passes_the_spec_and_never_refuses', async () => {
    const d = deps()
    await applyHookDecision('yes', head, 1, d)

    expect(d.approve).toHaveBeenCalledWith(head.spec)
    expect(d.refuse).not.toHaveBeenCalled()
  })

  it('test_approving_an_earlier_hook_does_not_close_the_gate', async () => {
    const d = deps()
    await applyHookDecision('yes', head, 2, d)

    expect(d.approve).toHaveBeenCalledTimes(1)
    expect(d.markReviewed).not.toHaveBeenCalled()
    expect(d.toast).not.toHaveBeenCalled()
  })

  it('test_declining_an_earlier_hook_refuses_it_and_keeps_the_gate_open', async () => {
    const d = deps()
    await applyHookDecision('no', head, 2, d)

    expect(d.refuse).toHaveBeenCalledWith('sha256:abc')
    expect(d.approve).not.toHaveBeenCalled()
    expect(d.markReviewed).not.toHaveBeenCalled()
  })

  it('test_the_failure_toast_names_the_cause_and_says_to_retry', async () => {
    const d = deps({ approve: vi.fn(() => Promise.reject(new Error('EROFS'))) })
    await applyHookDecision('yes', head, 1, d)

    expect(d.toast).toHaveBeenCalledTimes(1)
    const message = String(d.toast.mock.calls[0]?.[0])
    expect(message).toContain('EROFS')
    expect(message).toContain('approve again to retry')
  })

  it('test_a_retry_after_a_failed_approval_closes_the_gate', async () => {
    const approve = vi
      .fn<(spec: unknown) => Promise<void>>()
      .mockRejectedValueOnce(new Error('EROFS'))
      .mockResolvedValueOnce(undefined)
    const d = deps({ approve })

    await applyHookDecision('yes', head, 1, d)
    expect(d.markReviewed).not.toHaveBeenCalled()
    await applyHookDecision('yes', head, 1, d)

    expect(d.markReviewed).toHaveBeenCalledTimes(1)
    expect(d.toast).toHaveBeenCalledTimes(1)
  })

  it('test_the_gate_closes_only_after_the_approval_settles', async () => {
    let release: () => void = () => {}
    const approve = vi.fn(() => new Promise<void>((r) => (release = r)))
    const d = deps({ approve })

    const done = applyHookDecision('yes', head, 1, d)
    await Promise.resolve()
    expect(d.markReviewed, 'closed while the approval was still in flight').not.toHaveBeenCalled()
    release()
    await done
    expect(d.markReviewed).toHaveBeenCalledTimes(1)
  })
})
