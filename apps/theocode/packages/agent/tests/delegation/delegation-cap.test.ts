/**
 * The delegation cap: `Squad` runs the team with `timeoutMs`, cancels the member in flight when it
 * elapses, and the tool reports `delegation_timeout` with the recovery instruction.
 *
 * Fake timers advance the production cap, so no test waits on the wall clock.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DELEGATION_CAP_MS } from '../../src/delegation/squad.js'
import { fakeMember, runTool } from './team-harness.js'

const members = vi.hoisted(() => ({ list: [] as unknown[] }))
vi.mock('../../src/delegation/roles.js', async (orig) => ({
  ...(await orig<typeof import('../../src/delegation/roles.js')>()),
  buildRoleAgent: vi.fn(async () => members.list.shift()),
}))

afterEach(() => {
  vi.useRealTimers()
})

describe('a delegated run is cancelled when its cap elapses', () => {
  it('test_the_member_in_flight_is_cancelled_and_the_tool_reports_delegation_timeout', async () => {
    vi.useFakeTimers()
    const cancelled: string[] = []
    const explorer = fakeMember({ name: 'explorer', never: true, cancelled })
    members.list = [explorer, fakeMember({ name: 'worker', cancelled })]

    const outcome = runTool().then(
      () => undefined,
      (e: unknown) => e as Error & { code?: string },
    )
    // The cap clock starts when the squad runs; let the explorer be in flight before advancing it.
    for (let i = 0; i < 50 && explorer.send.mock.calls.length === 0; i += 1) {
      await vi.advanceTimersByTimeAsync(0)
    }
    expect(explorer.send).toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(DELEGATION_CAP_MS)
    const error = await outcome

    expect(cancelled, 'the member run was not aborted').toEqual(['explorer'])
    expect(error?.message).toMatch(/delegation_timeout[\s\S]*NOT reverted/)
    expect((error as { code?: string }).code).toBe('delegation_timeout')
  })

  it('test_cap_expiry_disposes_every_member', async () => {
    vi.useFakeTimers()
    const disposed: string[] = []
    const dispose = (n: string) => async () => {
      disposed.push(n)
    }
    members.list = [
      fakeMember({ name: 'explorer', never: true, dispose: dispose('explorer') }),
      fakeMember({ name: 'worker', dispose: dispose('worker') }),
    ]

    const outcome = runTool().catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(DELEGATION_CAP_MS)
    await outcome

    expect(disposed.sort()).toEqual(['explorer', 'worker'])
  })

  it('test_a_member_failing_before_the_cap_is_reported_failed_not_as_a_timeout', async () => {
    // NEGATIVE CASE: a crash is not a timeout; the operator must not be sent to inspect the tree.
    members.list = [
      fakeMember({ name: 'explorer', crash: 'the member agent crashed' }),
      fakeMember({ name: 'worker' }),
    ]

    const out = JSON.parse(await runTool()) as { status: string }

    expect(out.status).toBe('failed')
  })

  it('test_work_completing_before_the_cap_returns_its_value', async () => {
    // ANTI-VACUITY FLOOR: timing everything out would satisfy the test above.
    members.list = [fakeMember({ name: 'explorer' }), fakeMember({ name: 'worker' })]

    const out = JSON.parse(await runTool()) as { result: string; status: string }

    expect(out.status).toBe('completed')
    expect(out.result).toBe('worker done')
  })

  it('test_the_cap_is_fifteen_minutes', () => {
    expect(DELEGATION_CAP_MS).toBe(15 * 60_000)
  })
})
