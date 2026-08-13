import { describe, expect, it } from 'vitest'

import type { GoalEvent } from '../../src/loop/goal-runner.js'
import { formatGoalEvent } from '../../src/loop/format-goal-event.js'

/**
 * M69 — `formatGoalEvent`: one place that knows every `GoalEvent` variant.
 *
 * ## The gap
 *
 * `GoalEvent` is a closed discriminated union of five variants. A consumer rendering a goal run has
 * to switch on it, and TypeScript makes that switch exhaustive TODAY — which means the moment the
 * SDK adds a sixth variant in a minor, every consumer's switch is silently non-exhaustive at
 * runtime while still compiling against the older types they have installed.
 *
 * So every consumer wrote the same default branch for an event it could not name. The measured one
 * (`goal/goal.ts`) had exactly that.
 *
 * ## Why a helper and not an open union
 *
 * The milestone allowed either. An open union (`| { type: string & {} }`) would make the default
 * branch REQUIRED — the opposite of the stated effect, which is that the consumer stops writing it.
 * A helper owns the switch once, and the consumer calls a function.
 *
 * Exhaustive-safe means both halves: a compile-time `never` check, so adding a variant breaks the
 * build HERE where the knowledge lives, and a runtime fallback, so an event from an SDK minor ahead
 * of our installed types still formats instead of throwing in a render path.
 */

const events: GoalEvent[] = [
  { type: 'turn_start', turn: 1, goal: 'ship it' },
  { type: 'agent_response', turn: 1, content: 'working on it' },
  { type: 'judge_verdict', turn: 1, verdict: 'continue', reason: 'not yet', parseFailed: false },
  { type: 'continuation', turn: 2, prompt: 'keep going' },
  { type: 'status_change', status: 'completed', reason: 'goal met' },
]

describe('formatGoalEvent — every variant has a rendering', () => {
  it.each(events.map((e) => [e.type, e] as const))(
    'test_%s_formats_to_a_non_empty_line',
    (_type, event) => {
      const line = formatGoalEvent(event)
      expect(line).toBeTypeOf('string')
      expect(line.length).toBeGreaterThan(0)
    },
  )

  it('test_each_variant_produces_a_DISTINCT_rendering', () => {
    // Anti-vacuity floor: a helper returning `event.type` for everything would pass every assertion
    // above while formatting nothing. This is what makes the five cases mean five renderings.
    const rendered = events.map((e) => formatGoalEvent(e))
    expect(new Set(rendered).size).toBe(events.length)
  })

  it('test_the_rendering_carries_the_variants_own_payload', () => {
    // And the payload has to appear, or "distinct" could be satisfied by five different constants.
    expect(formatGoalEvent(events[0])).toContain('ship it')
    expect(formatGoalEvent(events[1])).toContain('working on it')
    expect(formatGoalEvent(events[2])).toContain('not yet')
    expect(formatGoalEvent(events[3])).toContain('keep going')
    expect(formatGoalEvent(events[4])).toContain('goal met')
  })
})

describe('formatGoalEvent — version skew', () => {
  it('test_an_unknown_variant_formats_instead_of_throwing', () => {
    // The runtime half. The SDK may emit a variant our installed types do not name yet; a render
    // path that throws on it turns a forward-compatible event into a crashed UI.
    const future = { type: 'telemetry_flush', turn: 9 } as unknown as GoalEvent
    const line = formatGoalEvent(future)
    expect(line).toContain('telemetry_flush')
  })

  it('test_the_unknown_rendering_says_it_is_unrecognised', () => {
    // Formatting it is not the same as pretending to understand it. The line has to read as an
    // unhandled event, or an operator sees a normal-looking line for something nobody handled.
    const future = { type: 'telemetry_flush' } as unknown as GoalEvent
    expect(formatGoalEvent(future)).toMatch(/unrecognised|unknown/i)
  })

  it('test_a_malformed_event_does_not_throw_either', () => {
    // Defensive, and cheap: the argument crosses a process boundary in every real deployment.
    expect(() => formatGoalEvent(undefined as unknown as GoalEvent)).not.toThrow()
    expect(() => formatGoalEvent({} as unknown as GoalEvent)).not.toThrow()
  })
})
