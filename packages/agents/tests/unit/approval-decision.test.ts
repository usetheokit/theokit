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
    //
    // The set is now PASSED rather than defaulted. What this test asserts is unchanged — which tools
    // the catalog considers write-scoped — but where the policy comes from is: the framework no
    // longer picks it, because it cannot know which tools a product registered. The earlier form of
    // this test read `shouldAutoApprove('auto-edit', 'edit_file')` with no set and expected `true`,
    // and that expectation IS the widening: it made "the framework has an opinion" indistinguishable
    // from "this product opted in". See the sibling describe block below.
    const catalog = { writeScopedTools: WRITE_SCOPED_TOOLS }

    expect(shouldAutoApprove('auto-edit', 'apply_patch', undefined, catalog)).toBe(true)
    expect(shouldAutoApprove('auto-edit', 'edit_file', undefined, catalog)).toBe(true)
    expect(shouldAutoApprove('auto-edit', 'write_file', undefined, catalog)).toBe(true)
    expect(
      shouldAutoApprove('auto-edit', 'run_shell', ENFORCED, catalog),
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

/**
 * The absorption was about to WIDEN a human-in-the-loop gate on a shipped product, silently.
 *
 * The framework's `WRITE_SCOPED_TOOLS` names three tools; the only real consumer auto-approves ONE.
 * That is not a difference of opinion about a list — it is the difference between two questions the
 * symbol had conflated:
 *
 *   - "does this tool bound its own writes to a write root?"  — a FACT about the SDK's tool factories
 *   - "may this tool run without asking a human?"             — a POLICY the PRODUCT owns
 *
 * The framework can answer the first. It cannot answer the second, because it does not know which
 * tools the product registered or what it renamed them to. Measured on the consumer that this plan
 * exists to let delete code: `chat.ts:272-273` registers `apply_patch` AND `edit_file` while
 * auto-approving only `apply_patch`. Adopting the framework default would have made `edit_file` —
 * a live, registered, model-callable tool — stop requiring a human, as a side effect of deleting
 * duplicated code. Nothing in the branch recorded that.
 *
 * The fix is the module's own B-006 shape applied to names instead of postures: an absent policy is
 * not a permissive one. `auto-edit` with no declared set asks. The asymmetry is the usual one — a
 * gate that asks too often costs a click, a gate that asks too rarely runs an unreviewed write.
 */
describe('shouldAutoApprove — an absent tool policy is not a permissive one', () => {
  const ENFORCED = { enforced: true }

  it('test_auto_edit_without_a_declared_tool_set_asks_the_human', () => {
    // Even for the tool everyone agrees on. Silence is not consent.
    expect(shouldAutoApprove('auto-edit', 'apply_patch')).toBe(false)
    expect(shouldAutoApprove('auto-edit', 'apply_patch', ENFORCED)).toBe(false)
  })

  it('test_auto_edit_honours_the_set_the_product_declares', () => {
    // Anti-vacuity floor: a branch that always returned false would satisfy the case above.
    const policy = { writeScopedTools: new Set(['apply_patch']) }

    expect(shouldAutoApprove('auto-edit', 'apply_patch', undefined, policy)).toBe(true)
    // The consumer registers edit_file and deliberately does NOT auto-approve it. Its policy, kept.
    expect(shouldAutoApprove('auto-edit', 'edit_file', undefined, policy)).toBe(false)
  })

  it('test_the_write_scoped_catalog_is_still_offered_for_products_that_want_it', () => {
    // Narrowing the DEFAULT must not delete the fact. A product that does want all three passes it.
    expect([...WRITE_SCOPED_TOOLS].sort((a, b) => a.localeCompare(b))).toEqual([
      'apply_patch',
      'edit_file',
      'write_file',
    ])
    expect(
      shouldAutoApprove('auto-edit', 'edit_file', undefined, {
        writeScopedTools: WRITE_SCOPED_TOOLS,
      }),
    ).toBe(true)
  })

  it('test_the_exported_catalog_cannot_be_widened_at_runtime', () => {
    // `ReadonlySet` is a COMPILE-TIME claim over a mutable Set. This is an approval gate reachable
    // from every consumer of the package: one `as Set<string>` and `rm_rf` auto-approves everywhere,
    // with no diff in the module that owns the rule. G10 — a constraint that does not constrain is
    // worse than an absent one, because it is believed.
    expect(() => {
      ;(WRITE_SCOPED_TOOLS as Set<string>).add('rm_rf')
    }).toThrow()
    expect(WRITE_SCOPED_TOOLS.has('rm_rf')).toBe(false)
  })
})
