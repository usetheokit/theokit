/**
 * #939 — a headless run whose approvals are all refused says so before the turn, with the reason.
 *
 * The refusal travelled only to the model, as a tool result. Measured on stock Ubuntu 24.04: the
 * operator saw `[sandbox] OS-level enforcement unavailable ...`, then a final message that the edit
 * "was blocked by the environment's approval/sandbox policy", and never the sentence that says why
 * or what would fix it.
 */
import { describe, expect, it } from 'vitest'

import { headlessRefusalNotice } from '../../src/commands/run.js'

describe('headlessRefusalNotice', () => {
  it('test_a_refused_policy_prints_its_reason', () => {
    const notice = headlessRefusalNotice({ approved: false, reason: 'no enforced sandbox' })

    expect(notice).toBe(
      '[approval] tool calls that need approval will be refused: no enforced sandbox\n',
    )
  })

  it('test_an_approved_policy_prints_nothing', () => {
    expect(headlessRefusalNotice({ approved: true, reason: 'confined by bwrap' })).toBeNull()
  })
})
