/**
 * T4.1 — the gate for the inverse of surface parity.
 *
 * `check-surface-parity.mjs` asks whether the layer FORWARDS what the SDK exports at a shared
 * subpath name. By construction it cannot ask anything about the layer's own inventions — its own
 * contract says so, and it skips 14 own-surface subpaths with the reason written down. Nothing asked
 * the inverse: when the layer invents a capability, is that capability reachable?
 *
 * Two live instances motivated this, both measured in this cycle:
 *
 *  - `ApprovalPosture` — the TYPE crossed the boundary; `applyPosture`, which is the entire
 *    enforcement, was exported by nothing. A surface could describe the posture and could not apply
 *    it, so the consumer wrote the rule twice.
 *  - `TheokitAgentError` — the base of 29 subclasses, unexported, so a `catch` could not
 *    discriminate framework errors.
 *
 * Each cost a consumer a rebuild. Without a gate, the next one costs the next consumer another.
 *
 * ## This is a heuristic and says so
 *
 * The rule is a PAIR — an exported type whose name looks like a decision, plus a function in the
 * SAME module taking that type as a parameter — because a name match alone would flag every type in
 * the package. It will still produce false positives (Risk R7), which is why the gate runs in warn
 * mode, prints its allowlist path, and the allowlist entries carry sunsets.
 */
import { describe, expect, it } from 'vitest'

import { findUnreachableEnforcement } from '../../scripts/lib/invention-reachability.mjs'

const POSTURE_MODULE = `
export type ApprovalPosture = { kind: 'interactive' } | { kind: 'auto-reject' }
export function applyPosture(extra: Record<string, unknown>, posture: ApprovalPosture): void {}
`

describe('findUnreachableEnforcement', () => {
  it('test_a_type_whose_enforcement_is_unpublished_is_reported', () => {
    // The ApprovalPosture shape exactly: the type reaches consumers, the function does not.
    const found = findUnreachableEnforcement({
      modules: [{ path: 'src/bridge/approval-posture.ts', text: POSTURE_MODULE }],
      publishedNames: new Set(['ApprovalPosture']),
    })
    expect(found).toHaveLength(1)
    expect(found[0].type).toBe('ApprovalPosture')
    expect(found[0].enforcement).toContain('applyPosture')
    expect(found[0].module).toBe('src/bridge/approval-posture.ts')
  })

  it('test_nothing_is_reported_when_the_enforcement_is_published', () => {
    const found = findUnreachableEnforcement({
      modules: [{ path: 'src/bridge/approval-posture.ts', text: POSTURE_MODULE }],
      publishedNames: new Set(['ApprovalPosture', 'applyPosture']),
    })
    expect(found).toEqual([])
  })

  it('test_a_type_that_is_not_published_is_not_the_gates_business', () => {
    // An internal type with an internal function is just internal code. The gate is about a
    // capability that CROSSED the boundary in half.
    const found = findUnreachableEnforcement({
      modules: [{ path: 'src/internal/thing.ts', text: POSTURE_MODULE }],
      publishedNames: new Set([]),
    })
    expect(found).toEqual([])
  })

  it('test_a_pure_type_module_is_not_flagged', () => {
    // The "no function consuming the type" clause. A module of type declarations by design has no
    // enforcement to be unreachable.
    const found = findUnreachableEnforcement({
      modules: [{ path: 'src/types.ts', text: `export type RetryPolicy = { attempts: number }\n` }],
      publishedNames: new Set(['RetryPolicy']),
    })
    expect(found).toEqual([])
  })

  it('test_a_type_whose_name_does_not_look_like_a_decision_is_ignored', () => {
    // Without the name shape the rule flags every type in the package, which is a gate nobody reads.
    const found = findUnreachableEnforcement({
      modules: [
        {
          path: 'src/a.ts',
          text: `export type UserRecord = { id: string }\nfunction useIt(r: UserRecord): void {}\n`,
        },
      ],
      publishedNames: new Set(['UserRecord']),
    })
    expect(found).toEqual([])
  })

  it('test_the_name_shapes_are_the_documented_set', () => {
    const shapes = ['Posture', 'Policy', 'Decision', 'Mode', 'Strategy']
    for (const shape of shapes) {
      const found = findUnreachableEnforcement({
        modules: [
          {
            path: 'src/a.ts',
            text: `export type Retry${shape} = { n: number }\nfunction useIt(r: Retry${shape}): void {}\n`,
          },
        ],
        publishedNames: new Set([`Retry${shape}`]),
      })
      expect(found, `${shape} must be one of the shapes the gate looks for`).toHaveLength(1)
    }
  })

  it('test_an_interface_counts_as_a_type', () => {
    const found = findUnreachableEnforcement({
      modules: [
        {
          path: 'src/a.ts',
          text: `export interface RetryPolicy { n: number }\nfunction useIt(p: RetryPolicy): void {}\n`,
        },
      ],
      publishedNames: new Set(['RetryPolicy']),
    })
    expect(found).toHaveLength(1)
  })

  it('test_an_allowlisted_type_is_not_reported_before_its_sunset', () => {
    const found = findUnreachableEnforcement({
      modules: [{ path: 'src/bridge/approval-posture.ts', text: POSTURE_MODULE }],
      publishedNames: new Set(['ApprovalPosture']),
      allowlist: [{ symbol: 'ApprovalPosture', sunset: '2099-01-01', rationale: 'deliberate' }],
      today: '2026-08-16',
    })
    expect(found).toEqual([])
  })

  it('test_an_expired_allowlist_entry_is_ignored_and_the_finding_re_fires', () => {
    // `code-quality-golden-rule.md` § 4. An entry past its sunset is not a weaker exemption, it is
    // no exemption — otherwise the allowlist becomes the place findings go to be forgotten.
    const found = findUnreachableEnforcement({
      modules: [{ path: 'src/bridge/approval-posture.ts', text: POSTURE_MODULE }],
      publishedNames: new Set(['ApprovalPosture']),
      allowlist: [{ symbol: 'ApprovalPosture', sunset: '2026-01-01', rationale: 'stale' }],
      today: '2026-08-16',
    })
    expect(found).toHaveLength(1)
    expect(found[0].allowlistExpired, 'the report must say the exemption lapsed').toBe(true)
  })

  it('test_several_consuming_functions_are_all_named_in_the_finding', () => {
    // Which function to export is the human's decision, so the report shows the candidates rather
    // than picking one.
    const found = findUnreachableEnforcement({
      modules: [
        {
          path: 'src/a.ts',
          text:
            `export type RetryPolicy = { n: number }\n` +
            `function applyIt(p: RetryPolicy): void {}\n` +
            `function validateIt(p: RetryPolicy): boolean { return true }\n`,
        },
      ],
      publishedNames: new Set(['RetryPolicy']),
    })
    expect(found[0].enforcement).toEqual(['applyIt', 'validateIt'])
  })

  it('test_one_published_consumer_is_enough_even_when_others_are_private', () => {
    // The question is "can a caller act on this type at all", not "is every helper exported".
    const found = findUnreachableEnforcement({
      modules: [
        {
          path: 'src/a.ts',
          text:
            `export type RetryPolicy = { n: number }\n` +
            `function privateHelper(p: RetryPolicy): void {}\n` +
            `export function applyRetry(p: RetryPolicy): void {}\n`,
        },
      ],
      publishedNames: new Set(['RetryPolicy', 'applyRetry']),
    })
    expect(found).toEqual([])
  })
})
