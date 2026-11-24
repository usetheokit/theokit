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
    members.list = [
      fakeMember({ name: 'explorer', never: true, cancelled }),
      fakeMember({ name: 'worker', cancelled }),
    ]

    const outcome = runTool().then(
      () => undefined,
      (e: unknown) => e as Error & { code?: string },
    )
    await vi.advanceTimersByTimeAsync(DELEGATION_CAP_MS)
    const error = await outcome

    expect(cancelled, 'the member run was not aborted').toEqual(['explorer'])
    expect(error?.message).toMatch(/delegation_timeout[\s\S]*NOT reverted/)
    expect((error as { code?: string }).code).toBe('delegation_timeout')
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
