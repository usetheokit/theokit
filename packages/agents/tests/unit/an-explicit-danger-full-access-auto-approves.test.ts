import { resolveSandboxPosture } from '@theokit/sdk/sandbox'
import { describe, expect, it } from 'vitest'

import { shouldAutoApprove } from '../../src/bridge/approval-decision.js'
import { applyPosture } from '../../src/bridge/approval-posture.js'
import type { HumanInTheLoopOptions } from '../../src/types.js'

/**
 * #939 — `danger-full-access` is the operator waiving confinement, and `full-auto` under it runs.
 *
 * The SDK reports that mode as `enforced: false`, so the rule "nothing auto-approves without
 * enforced confinement" refused it on every machine, bwrap or not. An operator who typed
 * `--sandbox danger-full-access -a never` asked for an unconfined run and got one that edited
 * nothing. Codex, whose flags these are, runs that combination without a sandbox.
 *
 * The waiver is read from the posture's `mode`, which the SDK sets from configuration, never from
 * detection: a sandbox that failed to start still reports the mode the operator asked for.
 */

const waived = resolveSandboxPosture({ mode: 'danger-full-access' })
const unavailable = {
  mode: 'workspace-write' as const,
  enforced: false,
  detail: 'tool-gating only, bwrap: user namespaces unavailable',
}

describe('an explicit danger-full-access lets full-auto run unconfined', () => {
  it('test_full_auto_under_danger_full_access_auto_approves', () => {
    expect(waived.enforced).toBe(false)
    expect(shouldAutoApprove('full-auto', 'run_command', waived)).toBe(true)
  })

  it('test_full_auto_with_a_sandbox_that_failed_to_start_still_refuses', () => {
    // The counter-proof: the waiver is the MODE, not the missing enforcement. A workspace-write
    // session whose bwrap cannot run asked for confinement and must not lose it silently.
    expect(shouldAutoApprove('full-auto', 'run_command', unavailable)).toBe(false)
  })

  it('test_a_posture_without_a_mode_still_counts_as_unconfined', () => {
    expect(shouldAutoApprove('full-auto', 'run_command', { enforced: false })).toBe(false)
  })

  it('test_danger_full_access_does_not_make_suggest_or_auto_edit_skip_the_human', () => {
    // Confinement and consent are different questions. Waiving the sandbox says nothing about
    // whether the operator wanted to be asked.
    expect(shouldAutoApprove('suggest', 'run_command', waived)).toBe(false)
    expect(shouldAutoApprove('auto-edit', 'run_command', waived)).toBe(false)
  })

  it('test_an_auto_approve_posture_under_danger_full_access_installs_without_throwing', () => {
    const gated = new Map([['run_command', { question: 'run it?' } as HumanInTheLoopOptions]])
    const extra: Record<string, unknown> = {}
    expect(() =>
      applyPosture(
        extra,
        {},
        { kind: 'auto-approve', confinedBy: waived, reason: 'operator chose danger-full-access' },
        gated,
      ),
    ).not.toThrow()
  })
})
