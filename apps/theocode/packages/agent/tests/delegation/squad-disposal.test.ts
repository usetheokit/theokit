/**
 * B-043's third bullet: a cleanup failure does not replace the delegation's own result.
 *
 * The item read `shipped` and the behaviour was real — `squad.ts` used `Promise.allSettled` with a
 * comment explaining why — but nothing tested it, and the bullet was phrased so loosely that the
 * backlog structure check flagged it as having nothing falsifiable in it. Both halves of that are
 * the same defect: a guarantee nobody can check is a guarantee nobody is holding.
 *
 * The hazard is a JavaScript one and easy to reintroduce: an `await` that rejects inside a `finally`
 * REPLACES the value the `try` block produced. With `Promise.all`, one member failing to dispose
 * threw away a delegation result the user had waited a full turn for.
 */
import { describe, expect, it } from 'vitest'

import { DELEGATION_CAP_MS, runTeamWithCap } from '../../src/delegation/squad.js'

/** The disposal guarantees, exercised through the capped runner that now owns them. */
const disposeMembers = async (
  members: readonly { [Symbol.asyncDispose]: () => PromiseLike<void> }[],
  report: (line: string) => void,
): Promise<void> => {
  await runTeamWithCap(members, async () => undefined, report)
}

const member = (onDispose: () => Promise<void>) => ({ [Symbol.asyncDispose]: onDispose })
const ok = (): (() => Promise<void>) => async () => {}
const boom =
  (why: string): (() => Promise<void>) =>
  async () => {
    throw new Error(why)
  }

describe('runTeamWithCap disposal', () => {
  it('test_a_clean_disposal_reports_nothing', async () => {
    const lines: string[] = []

    await disposeMembers([member(ok()), member(ok())], (l) => lines.push(l))

    expect(lines).toEqual([])
  })

  it('test_one_member_failing_does_not_stop_the_others_from_being_disposed', async () => {
    // `Promise.all` would short-circuit and leave the later members undisposed — a leaked agent per
    // failure, which is the second cost of the original shape.
    const disposed: string[] = []
    const members = [
      member(async () => {
        disposed.push('a')
      }),
      member(boom('member b exploded')),
      member(async () => {
        disposed.push('c')
      }),
    ]

    await disposeMembers(members, () => {})

    expect(disposed).toEqual(['a', 'c'])
  })

  it('test_a_failed_disposal_is_reported_rather_than_swallowed', async () => {
    const lines: string[] = []

    await disposeMembers([member(boom('socket already closed'))], (l) => lines.push(l))

    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('failed to dispose')
    expect(lines[0], 'the reason was dropped').toContain('socket already closed')
  })

  it('test_it_never_rejects_even_when_every_member_fails', async () => {
    // The property the `finally` depends on. If this ever rejects, the caller's result is replaced
    // by this error and the user loses the turn.
    await expect(
      disposeMembers([member(boom('x')), member(boom('y'))], () => {}),
    ).resolves.toBeUndefined()
  })

  it('test_a_result_produced_before_cleanup_survives_a_cleanup_failure', async () => {
    // B-043's bullet, made falsifiable: the exact `try`/`finally` shape the handler uses, asserting
    // the returned value rather than the absence of a throw.
    async function delegateWithFailingCleanup(): Promise<string> {
      try {
        return 'the delegation result the user waited for'
      } finally {
        await disposeMembers([member(boom('cleanup blew up'))], () => {})
      }
    }

    await expect(delegateWithFailingCleanup()).resolves.toBe(
      'the delegation result the user waited for',
    )
  })
})

describe('a squad that hits the delegation cap cancels its members', () => {
  it('test_cap_expiry_disposes_every_member_and_reports_the_recovery_message', async () => {
    const disposed: string[] = []
    const members = ['explorer', 'worker'].map((n) =>
      member(async () => {
        disposed.push(n)
      }),
    )

    await expect(
      runTeamWithCap(members, () => new Promise<string>(() => {}), () => {}, 5),
    ).rejects.toThrow(/delegation_timeout[\s\S]*NOT reverted/)

    expect(disposed).toHaveLength(2)
  })

  it('test_work_failing_before_the_cap_surfaces_its_own_error', async () => {
    await expect(
      runTeamWithCap([], () => Promise.reject(new Error('the member agent crashed')), () => {}),
    ).rejects.toThrow('the member agent crashed')
  })
})

describe('the default cap', () => {
  it('test_the_default_cap_is_fifteen_minutes', () => {
    expect(DELEGATION_CAP_MS).toBe(15 * 60_000)
  })
})
