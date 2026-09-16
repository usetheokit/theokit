/**
 * T4.2 — `goal/` shipped 3 source files and zero tests, and it drives BILLABLE autonomous turns.
 *
 * Scope, stated rather than implied: `runGoal` is a thin driver. It validates the agent surface,
 * delegates to a loop generator, and forwards what that generator yields. The turn and token bounds
 * live in `@theokit/agents`' `defaultGoalLoop`, NOT here — so these tests do not claim to cover
 * them, and a test asserting "the driver stops after maxTurns" would be testing the SDK through a
 * mock and proving nothing about either.
 *
 * What this module does decide, and what is therefore tested: whether an unusable agent fails fast
 * with a typed error, and whether every event the loop produces actually reaches the surface. A
 * dropped event is a goal run the user watches in silence.
 */
import { describe, expect, it } from 'vitest'

import { GOAL_DEFAULTS, GoalRunUnsupportedError, runGoal } from '../../src/goal/goal.js'

/** A loop generator that yields the given events and then returns the result. */
function loopOf(events: readonly unknown[], result: unknown) {
  return function* fake(): Generator<never, unknown, void> {
    for (const e of events) yield e as never
    return result
  } as never
}

const agentWithSend = { send: () => undefined } as never

describe('T4.2 — an agent that cannot drive a goal is refused, not attempted', () => {
  it('test_an_agent_without_send_is_refused_with_a_typed_error', async () => {
    // NEGATIVE CASE. This is the fail-fast boundary (rules/error-handling.md § 2): starting a goal
    // against an agent with no send() would burn a billable turn before failing somewhere deeper.
    await expect(
      runGoal({ notAnAgent: true } as never, 'ship it', {} as never, { onLine: () => undefined }),
    ).rejects.toBeInstanceOf(GoalRunUnsupportedError)
  })

  it('test_null_is_refused_rather_than_dereferenced', async () => {
    // NEGATIVE CASE, edge of the same guard: `typeof null === 'object'`, so a null check that only
    // tested the type would pass this and then throw a TypeError instead of the domain error.
    await expect(
      runGoal(null as never, 'ship it', {} as never, { onLine: () => undefined }),
    ).rejects.toBeInstanceOf(GoalRunUnsupportedError)
  })

  it('test_an_agent_with_send_is_accepted', async () => {
    // ANTI-VACUITY FLOOR: refusing every agent would satisfy both assertions above and no goal
    // would ever run.
    await expect(
      runGoal(agentWithSend, 'ship it', {} as never, {
        onLine: () => undefined,
        loop: loopOf([], 'finished'),
      }),
    ).resolves.toBe('finished')
  })
})

describe('T4.2 — every event the loop yields reaches the surface', () => {
  it('test_each_event_is_forwarded_to_the_event_sink', async () => {
    const seen: unknown[] = []

    await runGoal(agentWithSend, 'ship it', {} as never, {
      onLine: () => undefined,
      onEvent: (e) => seen.push(e),
      loop: loopOf(
        [
          { type: 'turn_start', turn: 1 },
          { type: 'turn_start', turn: 2 },
          { type: 'status_change', status: 'completed' },
        ],
        'ok',
      ),
    })

    expect(seen, 'the loop yielded 3 events and the sink saw a different number').toHaveLength(3)
  })

  it('test_the_loop_return_value_is_the_result_and_is_not_forwarded_as_an_event', async () => {
    // The generator's RETURN is the result, not a step. Forwarding it would render a phantom final
    // event in the goal feed.
    const seen: unknown[] = []

    const result = await runGoal(agentWithSend, 'ship it', {} as never, {
      onLine: () => undefined,
      onEvent: (e) => seen.push(e),
      loop: loopOf([{ type: 'turn_start', turn: 1 }], { status: 'completed' }),
    })

    expect(result).toEqual({ status: 'completed' })
    expect(seen).toHaveLength(1)
  })

  it('test_a_run_with_no_events_still_returns_its_result', () => {
    // EDGE CASE: the empty-but-valid run. A loop that completes without yielding must not hang.
    return expect(
      runGoal(agentWithSend, 'ship it', {} as never, {
        onLine: () => undefined,
        loop: loopOf([], { status: 'completed' }),
      }),
    ).resolves.toEqual({ status: 'completed' })
  })
})

describe('T4.2 — an event type the driver does not recognise must not crash the run', () => {
  it('test_an_unknown_event_type_does_not_throw', async () => {
    // Found by these tests, not by review. `formatGoalEvent` is a switch with no default, exhaustive
    // over the DECLARED GoalEvent union — so `tsc` is satisfied. But events arrive at RUNTIME from
    // @theokit/agents, and the moment the SDK adds a variant this repository has not compiled
    // against, the switch returns undefined and `line.length` throws a raw TypeError. The user's
    // goal run dies mid-flight, on a message that says nothing about goals.
    //
    // Per rules/error-handling.md § 2: an unrecognised event is not exceptional, it is forward
    // compatibility. It renders as nothing rather than killing the loop.
    const seen: unknown[] = []

    await expect(
      runGoal(agentWithSend, 'ship it', {} as never, {
        onLine: (l) => seen.push(l),
        loop: loopOf([{ type: 'a_variant_from_a_newer_sdk' }], 'ok'),
      }),
    ).resolves.toBe('ok')

    expect(seen, 'an unrecognised event rendered a line').toEqual([])
  })

  it('test_a_known_event_still_renders_its_line', async () => {
    // ANTI-VACUITY FLOOR: rendering nothing for everything would satisfy the assertion above and
    // the goal feed would be permanently blank.
    const seen: string[] = []

    await runGoal(agentWithSend, 'ship it', {} as never, {
      onLine: (l) => seen.push(l),
      loop: loopOf([{ type: 'turn_start', turn: 7 }], 'ok'),
    })

    expect(seen).toEqual(['▶ turn 7'])
  })
})

describe('T4.2 — the declared budget is a real budget', () => {
  it('test_the_goal_defaults_are_bounded', () => {
    // These are what a `goal` run costs when the user passes no flags. A zero or absent bound here
    // is an unbounded billable loop.
    expect(GOAL_DEFAULTS.maxTurns).toBeGreaterThan(0)
    expect(GOAL_DEFAULTS.tokenBudget).toBeGreaterThan(0)
    expect(GOAL_DEFAULTS).toEqual({ maxTurns: 20, tokenBudget: 150_000 })
  })
})
