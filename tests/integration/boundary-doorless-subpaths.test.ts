/**
 * T4.2 — the boundary claim, measured instead of asserted.
 *
 * `packages/agents/src/index.ts` declared the layered boundary CLOSED: "the consumer imports ZERO
 * `@theokit/sdk*` directly". Measured against the consumed SDK (4.52.1), 25 of its published
 * subpaths have no door in this layer at all, and 5 more are partially covered. A boundary
 * documented as closed and measurably open is worse than one documented as partial, because a
 * consumer reads the claim and stops looking — which is exactly how a builder ends up rebuilding
 * what already ships.
 *
 * `check-surface-parity.mjs` cannot answer this. Its own contract says so: it compares subpaths the
 * two packages publish under the SAME NAME, six of them, and skips the rest with a written reason.
 * A subpath with no door on this side has no shared name to compare, so it was invisible to the
 * gate — not by oversight, by construction.
 *
 * ## What this test demands, and what it deliberately does not
 *
 * It demands a WRITTEN DECISION per doorless subpath, in the same spirit as the sibling gate:
 * `forward` (a door is expected) or a reason it stays out. It does NOT demand coverage. Bulk
 * forwarding would grow the public surface with no consumer, which `system-design-guardrails.md`
 * § G7 and § G11 both forbid, and would turn a real measurement into 25 exports nobody asked for.
 *
 * The decisions live next to their measurement so a reader can check the reasoning rather than
 * trust it.
 */
import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

import { DOORLESS_DECISIONS } from '../../scripts/lib/boundary-decisions.mjs'

const require_ = createRequire(new URL('../../packages/agents/package.json', import.meta.url))

function sdkSubpaths(): string[] {
  const sdk = require_('@theokit/sdk/package.json') as { exports: Record<string, unknown> }
  return Object.keys(sdk.exports).filter((s) => s !== './package.json')
}

function layerDoors(): Set<string> {
  const layer = require_('./package.json') as { exports: Record<string, unknown> }
  return new Set(Object.keys(layer.exports))
}

describe('the layered boundary, as measured', () => {
  it('test_every_doorless_sdk_subpath_carries_a_written_decision', () => {
    // The mechanism. A subpath the SDK adds later arrives here as a failing test naming it, rather
    // than as a silent hole behind a comment that says the boundary is closed.
    const doors = layerDoors()
    const doorless = sdkSubpaths().filter((s) => !doors.has(s))
    const undecided = doorless.filter((s) => !(s in DOORLESS_DECISIONS))
    expect(
      undecided,
      `these SDK subpaths have no door in @theokit/agents and no recorded decision: ` +
        `${undecided.join(', ')}. Add an entry to scripts/lib/boundary-decisions.mjs — 'forward' ` +
        `or a written reason. A decision is cheap; a silent hole cost a consumer a rebuild.`,
    ).toEqual([])
  })

  it('test_no_decision_describes_a_subpath_that_does_not_exist', () => {
    // The inverse rot: a decision left behind after the SDK drops a subpath reads as considered
    // ground that nobody has considered in a year.
    const known = new Set(sdkSubpaths())
    const stale = Object.keys(DOORLESS_DECISIONS).filter((s) => !known.has(s))
    expect(
      stale,
      `decisions for subpaths the SDK no longer publishes: ${stale.join(', ')}`,
    ).toEqual([])
  })

  it('test_no_decision_describes_a_subpath_that_already_has_a_door', () => {
    // If a door was added, the decision is obsolete and `check-surface-parity.mjs` owns the subpath
    // from then on. Two gates believing they own the same subpath is how each assumes the other is
    // checking it.
    const doors = layerDoors()
    const overlapping = Object.keys(DOORLESS_DECISIONS).filter((s) => doors.has(s))
    expect(overlapping).toEqual([])
  })

  it('test_every_decision_states_a_reason_or_asks_for_a_door', () => {
    for (const [subpath, decision] of Object.entries(DOORLESS_DECISIONS)) {
      if (decision === 'forward') continue
      expect(typeof decision.out, `${subpath} must carry a written reason`).toBe('string')
      expect(
        decision.out.length,
        `${subpath}'s reason is too short to be a reason — a placeholder here is worse than no ` +
          `entry, because it reads as a decision somebody made`,
      ).toBeGreaterThan(40)
    }
  })

  it('test_a_forward_decision_is_backed_by_an_actual_door', () => {
    // `forward` is a promise. Without this, "we decided to forward it" becomes a decision that
    // outlives the work it describes — the same drift as a `[x]` on an unshipped milestone.
    const doors = layerDoors()
    const promised = Object.entries(DOORLESS_DECISIONS)
      .filter(([, d]) => d === 'forward')
      .map(([s]) => s)
      .filter((s) => !doors.has(s))
    expect(
      promised,
      `these subpaths are decided 'forward' but have no door yet: ${promised.join(', ')}`,
    ).toEqual([])
  })
})
