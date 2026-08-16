/**
 * T2.1 — the auto-approve rule becomes a symbol a SURFACE can call.
 *
 * ## What was wrong
 *
 * `bridge/approval-posture.ts:69-72` states in its own JSDoc that the consumer implemented this
 * refusal TWICE — `shouldAutoApprove` in the TUI and `resolveHeadlessApproval` in the headless path
 * — and calls a security rule duplicated across two call sites a G12 violation that "will eventually
 * disagree with itself". It then says the rule now lives once.
 *
 * It did not. `applyPosture` holds the enforcement and is exported by nothing; `ApprovalPosture`
 * crosses as a TYPE only. And the signature answers a different question: `(extra, m8, posture,
 * gated)` mutates an options bag at agent-construction time, while a surface needs to ask, per
 * event, *"may I auto-approve THIS tool right now?"*. Both consumer copies are still live — the TUI
 * one was modified 2026-08-15.
 *
 * ## The two scars this absorbs (ADR D5)
 *
 *  - **B-006** — an absent posture counts as UNCONFINED. "Absence of evidence is not evidence of
 *    confinement, and defaulting the other way would silently disable the guard anywhere the posture
 *    has not been threaded through."
 *  - **B-021** — the headless copy made the posture required *because* omitting it used to return
 *    `approved: true` for full-auto, skipping the very refusal the function exists for.
 *
 * Both reduce to one invariant, asserted below: **nothing auto-approves without positive evidence of
 * enforced confinement.** The type keeps `posture` optional so a surface that has not threaded it
 * through still compiles — and still gets `false`.
 */
import { describe, expect, it } from 'vitest'

import {
  APPROVAL_MODES,
  shouldAutoApprove,
  WRITE_SCOPED_TOOLS,
  type ApprovalMode,
} from '../../src/bridge/approval-decision.js'

const ENFORCED = { enforced: true, mode: 'bwrap', detail: 'kernel namespaces' } as const
const UNENFORCED = { enforced: false, mode: 'none', detail: 'bwrap unavailable' } as const

describe('shouldAutoApprove — the rule, reachable', () => {
  it('test_absent_posture_never_auto_approves', () => {
    // B-006. The most consequential default in the function: every mode, no posture, no approval.
    for (const mode of APPROVAL_MODES) {
      expect(
        shouldAutoApprove(mode, 'run_shell'),
        `mode "${mode}" auto-approved a shell command with no posture at all`,
      ).toBe(false)
    }
  })

  it('test_full_auto_requires_enforced_confinement', () => {
    expect(shouldAutoApprove('full-auto', 'run_shell', ENFORCED)).toBe(true)
    // B-021 — an unenforced posture is a claim contradicted by the sandbox itself. Refusing is the
    // whole point: running commands on the strength of a false claim is the outcome the gate exists
    // to prevent.
    expect(shouldAutoApprove('full-auto', 'run_shell', UNENFORCED)).toBe(false)
  })

  it('test_suggest_never_auto_approves', () => {
    expect(shouldAutoApprove('suggest', 'apply_patch', ENFORCED)).toBe(false)
    expect(shouldAutoApprove('suggest', 'run_shell', ENFORCED)).toBe(false)
  })

  it('test_auto_edit_only_covers_write_scoped_tools', () => {
    // `auto-edit` is bounded by the TOOL's own write scope rather than by the kernel, so it does not
    // need an enforced posture — but it covers only tools that carry that scope.
    expect(shouldAutoApprove('auto-edit', 'apply_patch')).toBe(true)
    expect(shouldAutoApprove('auto-edit', 'edit_file')).toBe(true)
    expect(shouldAutoApprove('auto-edit', 'write_file')).toBe(true)
    expect(
      shouldAutoApprove('auto-edit', 'run_shell', ENFORCED),
      'auto-edit must not approve a shell: a command is not bounded by a write root',
    ).toBe(false)
  })

  it('test_unknown_tool_under_auto_edit_is_refused', () => {
    // The B-006 failure shape applied to names: defaulting to true would silently open the gate
    // anywhere a tool name has not been threaded through.
    expect(shouldAutoApprove('auto-edit', 'a_tool_nobody_registered', ENFORCED)).toBe(false)
  })

  it('test_a_renamed_write_tool_is_covered_by_an_explicit_override', () => {
    // Names are the product's: the registry re-names factories (`withName('edit_file')`). The
    // default set uses the factory defaults, and a product that renamed them says so rather than
    // losing the behaviour silently.
    expect(shouldAutoApprove('auto-edit', 'patch')).toBe(false)
    expect(
      shouldAutoApprove('auto-edit', 'patch', undefined, {
        writeScopedTools: new Set(['patch']),
      }),
    ).toBe(true)
  })

  it('test_the_default_write_scoped_set_matches_the_factory_default_names', () => {
    // Derived from the SDK factories' own defaults (`apply-patch.ts:51`, `edit-file.ts:155`,
    // `write-file.ts:86`) rather than invented here.
    expect([...WRITE_SCOPED_TOOLS].sort((a, b) => a.localeCompare(b))).toEqual([
      'apply_patch',
      'edit_file',
      'write_file',
    ])
  })

  it('test_approval_modes_are_the_three_the_consumer_uses', () => {
    expect([...APPROVAL_MODES]).toEqual(['suggest', 'auto-edit', 'full-auto'])
    const mode: ApprovalMode = 'full-auto'
    expect(APPROVAL_MODES).toContain(mode)
  })
})
