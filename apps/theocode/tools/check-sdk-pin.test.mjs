/**
 * Tests for the SDK pin guard.
 *
 * #69 — `package.json` carried an npm-style `overrides` block pinning `@theokit/sdk` to `^4.63.3`
 * while the effective version was `5.0.0-next.1`. Under pnpm that block is INERT: pnpm reads
 * `pnpm-workspace.yaml`, so the number sat there being wrong and reading as a control that works.
 * The issue's own words: an override nobody needs is worse than none.
 *
 * Deleting it leaves two declarations that must agree — the root devDependency, which the BUILD
 * genuinely needs (`tools/build-cli.mjs` copies `provider-catalog.json` out of the SDK), and the
 * pnpm override that decides what the whole tree resolves to. This is the check the issue asked
 * for: one that fails, rather than a corrected number that drifts again.
 */
import { describe, expect, it } from 'vitest'

import { disagreement, resolvedDisagreement } from './check-sdk-pin.mjs'

describe('the SDK pin', () => {
  it('test_matching_declarations_pass', () => {
    expect(disagreement('{"devDependencies":{"@theokit/sdk":"1.2.3"}}', "overrides:\n  '@theokit/sdk': 1.2.3\n")).toBeUndefined()
  })

  it('test_a_disagreement_is_reported_with_both_values', () => {
    // The #69 shape, exactly.
    const out = disagreement(
      '{"devDependencies":{"@theokit/sdk":"5.0.0-next.1"},"overrides":{"@theokit/sdk":"^4.63.3"}}',
      "overrides:\n  '@theokit/sdk': 5.0.0-next.1\n",
    )

    expect(out, 'an npm overrides block pinning a different version was accepted').toContain('^4.63.3')
  })

  it('test_a_devDependency_that_drifts_from_the_override_is_reported', () => {
    const out = disagreement('{"devDependencies":{"@theokit/sdk":"9.9.9"}}', "overrides:\n  '@theokit/sdk': 1.2.3\n")

    expect(out).toContain('9.9.9')
    expect(out).toContain('1.2.3')
  })

  it('test_an_absent_override_is_reported_rather_than_passing', () => {
    // Absence of the pin is absence of the guarantee, never a pass — the same rule the mutation
    // detector applies to a report it cannot read.
    expect(disagreement('{"devDependencies":{"@theokit/sdk":"1.2.3"}}', 'overrides:\n')).toContain('no `@theokit/sdk` override')
  })

  it('test_a_repository_that_does_not_declare_the_sdk_is_not_the_guard_s_business', () => {
    // Anti-vacuity in the other direction: this must not fail a tree that legitimately has no pin.
    expect(disagreement('{"devDependencies":{}}', 'overrides:\n')).toBeUndefined()
  })

  it('test_an_overrides_block_for_any_other_package_is_also_refused', () => {
    // The rule is about the FILE, not the entry. A redundant override is the same defect as a wrong
    // one with a luckier value — both read as a control that works, and neither is read by pnpm.
    const out = disagreement(
      '{"devDependencies":{"@theokit/sdk":"1.2.3"},"overrides":{"left-pad":"^1.0.0"}}',
      "overrides:\n  '@theokit/sdk': 1.2.3\n",
    )

    expect(out).toContain('left-pad')
  })

  it('test_a_quoted_yaml_value_equals_the_unquoted_json_one', () => {
    // The guard's own first run reported a disagreement between a version and ITSELF: YAML accepts
    // `'5.0.0-next.1'` and `5.0.0-next.1` as the same string, and the raw capture kept the quotes.
    // Found by running it, not by reading it.
    expect(
      disagreement('{"devDependencies":{"@theokit/sdk":"5.0.0-next.1"}}', "overrides:\n  '@theokit/sdk': '5.0.0-next.1'\n"),
    ).toBeUndefined()
  })
})

/**
 * A THIRD place can pin it now, and the guard has to see it.
 *
 * `packages/agent` declares `@theokit/sdk` directly since `readSessionMessages` landed (#70): the
 * read side of a resumed session is only reachable from the SDK, and `@theokit/agents@12.1.0` does
 * not forward it. That is a real declaration carrying a version, so it is a third number that can
 * drift from the other two — the exact defect #69 was about, one file over.
 */
describe('#70 — the workspace package that now declares the SDK', () => {
  const ws = "overrides:\n  '@theokit/sdk': '5.0.0-next.4'\n"
  const root = '{"devDependencies":{"@theokit/sdk":"5.0.0-next.4"}}'

  it('test_a_workspace_pin_that_agrees_is_accepted', () => {
    const agent = '{"dependencies":{"@theokit/sdk":"5.0.0-next.4"}}'

    expect(
      disagreement(root, ws, [{ path: 'packages/agent/package.json', json: agent }]),
    ).toBeUndefined()
  })

  it('test_a_workspace_pin_that_drifts_is_reported_by_path', () => {
    const agent = '{"dependencies":{"@theokit/sdk":"5.0.0-next.1"}}'

    const out = disagreement(root, ws, [{ path: 'packages/agent/package.json', json: agent }])

    expect(out, 'a workspace pinning a different version was accepted').toContain(
      'packages/agent/package.json',
    )
    expect(out, 'the drifting value is not named, so nobody can act on it').toContain('5.0.0-next.1')
  })

  it('test_a_workspace_that_does_not_declare_it_is_not_a_disagreement', () => {
    // Three of the four packages do not import the SDK, and must not be forced to name it.
    const other = '{"dependencies":{"@theokit/agents":"^12.1.0"}}'

    expect(
      disagreement(root, ws, [{ path: 'packages/tui/package.json', json: other }]),
    ).toBeUndefined()
  })

  it('test_no_workspace_argument_behaves_exactly_as_before', () => {
    // Anti-regression: the guard is called with two arguments everywhere it existed before.
    expect(disagreement(root, ws)).toBeUndefined()
  })
})

/**
 * #120 — an EXACT pin must equal what the tree resolved.
 *
 * The three declarations this file already reconciles are all declarative: they agree with each
 * other while every one of them can be wrong about the tree. Measured 2026-09-07:
 *
 *   package.json          @theokit/agents  13.0.0-next.3
 *   pnpm-workspace.yaml   @theokit/agents  13.0.0-next.3
 *   node_modules          @theokit/agents  13.0.0-next.2      ← what actually ran
 *
 * `pnpm install --force` reported success and left the older copy in place, because the
 * `minimumReleaseAge` supply-chain policy rejected the newer entry and the default path swallowed
 * the rejection. Only `--no-frozen-lockfile` surfaced it.
 *
 * That matters here specifically because every upstream verification starts with *raise the pin,
 * then measure*. A pin that silently does not move means the next measurement answers about the
 * wrong artifact while the files and the operator all believe otherwise. It was caught by a habit —
 * `readlink -f` right after a bump — and a habit is not a gate.
 */
describe('#120 — the declared pin and the resolved tree', () => {
  it('test_an_exact_pin_that_does_not_match_the_resolved_copy_is_reported', () => {
    const found = resolvedDisagreement(
      [{ path: 'package.json', name: '@theokit/agents', version: '13.0.0-next.3' }],
      new Map([['@theokit/agents', '13.0.0-next.2']]),
    )
    expect(found).toMatch(/13\.0\.0-next\.3/)
    expect(found).toMatch(/13\.0\.0-next\.2/)
  })

  it('test_a_matching_pin_is_silent', () => {
    // Anti-vacuity. A rule that reported on every pin would satisfy the arm above and fail every run.
    expect(
      resolvedDisagreement(
        [{ path: 'package.json', name: '@theokit/sdk', version: '5.3.0' }],
        new Map([['@theokit/sdk', '5.3.0']]),
      ),
    ).toBeUndefined()
  })

  it('test_a_RANGE_is_not_checked_by_equality', () => {
    // The design decision, and the one that would make this guard noise if it were wrong. Three of
    // the five `@theokit/*` declarations here are ranges (`^0.2.1`, `^0.8.0`, `^0.80.0`). A range
    // resolving ABOVE its floor is the range working, not drift. Only an exact pin asserts identity.
    expect(
      resolvedDisagreement(
        [{ path: 'packages/tui/package.json', name: '@theokit/tui', version: '^0.80.0' }],
        new Map([['@theokit/tui', '0.81.4']]),
      ),
    ).toBeUndefined()
  })

  it('test_a_pin_with_nothing_installed_is_reported_rather_than_passed', () => {
    // Absence is not agreement. A tree with no copy at all passes an equality check that skips
    // missing entries, and reads as "the pin is honoured" — the direction this guard exists to
    // refuse.
    const found = resolvedDisagreement(
      [{ path: 'package.json', name: '@theokit/agents', version: '13.0.0-next.3' }],
      new Map(),
    )
    expect(found).toMatch(/not installed|no resolved copy/i)
  })

  it('test_a_version_inside_a_yaml_comment_is_not_read_as_the_override', () => {
    // The regex scanned the whole file and took the FIRST match, so a comment mentioning the package
    // with a version outranked the override twenty lines below it. Measured in CI on 2026-09-13: a
    // comment recording WHY the override exists — `@theokit/agents@14.0.0` declares
    // `@theokit/sdk: ^5.3.0` — made the gate report a disagreement between 5.6.0 and a string it had
    // read out of prose, complete with the trailing backtick and comma.
    //
    // The failure direction is what makes it worth a test rather than a reworded comment: the gate
    // exists to catch a real pin drift, and a parser this easy to distract fails on the commit that
    // documents the override and passes on the one that breaks it.
    const yaml = [
      '# `@theokit/agents@14.0.0` declares `@theokit/sdk: ^5.3.0`, and stable 5.x exists since 5.3.0.',
      'overrides:',
      "  '@theokit/sdk': '5.6.0'",
    ].join('\n')

    expect(
      disagreement(JSON.stringify({ dependencies: { '@theokit/sdk': '5.6.0' } }), yaml),
    ).toBeUndefined()
  })

  it('test_a_real_disagreement_is_still_caught_when_a_comment_is_present', () => {
    // The control. Ignoring comments must not turn the gate off — a genuine drift beneath the same
    // comment still has to fail, or the fix would have removed the check instead of repairing it.
    const yaml = [
      '# `@theokit/agents@14.0.0` declares `@theokit/sdk: ^5.3.0`.',
      'overrides:',
      "  '@theokit/sdk': '5.4.0'",
    ].join('\n')

    expect(
      disagreement(JSON.stringify({ dependencies: { '@theokit/sdk': '5.6.0' } }), yaml),
    ).toMatch(/5\.4\.0/)
  })
})
