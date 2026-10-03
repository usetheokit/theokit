/**
 * #939: a headless run says before the turn what will happen to its approvals, and why.
 *
 * The refusal travelled only to the model, as a tool result. Measured on stock Ubuntu 24.04: the
 * operator saw `[sandbox] OS-level enforcement unavailable ...`, then a final message that the edit
 * "was blocked by the environment's approval/sandbox policy", and never the sentence that says why
 * or what would fix it.
 */
import { describe, expect, it } from 'vitest'

import { headlessApprovalNotice } from '../../src/commands/run.js'

describe('headlessApprovalNotice', () => {
  it('test_a_refused_policy_prints_its_reason', () => {
    const notice = headlessApprovalNotice({ approved: false, reason: 'no enforced sandbox' })

    expect(notice).toBe(
      '[approval] tool calls that need approval will be refused: no enforced sandbox\n',
    )
  })

  it('test_an_approved_policy_prints_nothing', () => {
    expect(headlessApprovalNotice({ approved: true, reason: 'confined by bwrap' })).toBeNull()
  })

  it('test_an_unconfined_approval_warns_before_the_turn', () => {
    // #939: danger-full-access runs, and the operator reads that it runs with nothing around it.
    const notice = headlessApprovalNotice({
      approved: true,
      unconfined: true,
      reason: 'sandbox_mode="danger-full-access"',
    })

    expect(notice).toBe(
      '[approval] WARNING: tool calls will run without asking and with NO sandbox: ' +
        'sandbox_mode="danger-full-access"\n',
    )
  })
})
