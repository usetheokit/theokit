/**
 * B-043's third bullet: a cleanup failure does not replace the delegation's own result.
 *
 * `Squad` (`ownsMembers`, `onDisposeError`) holds the guarantee; these tests hold TheoCode to using it.
 */
import { describe, expect, it, vi } from 'vitest'

import { fakeMember, runTool } from './team-harness.js'

const members = vi.hoisted(() => ({ list: [] as unknown[] }))
vi.mock('../../src/delegation/roles.js', async (orig) => ({
  ...(await orig<typeof import('../../src/delegation/roles.js')>()),
  buildRoleAgent: vi.fn(async () => members.list.shift()),
}))

describe('team member disposal', () => {
  it('test_a_clean_disposal_reports_nothing', async () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    members.list = [fakeMember({ name: 'explorer' }), fakeMember({ name: 'worker' })]

    await runTool()

    expect(write).not.toHaveBeenCalled()
    write.mockRestore()
  })

  it('test_a_failing_dispose_is_reported_once_with_its_role_and_the_result_survives', async () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const disposed: string[] = []
    members.list = [
      fakeMember({
        name: 'explorer',
        dispose: async () => {
          disposed.push('explorer')
          throw new Error('socket already closed')
        },
      }),
      fakeMember({
        name: 'worker',
        dispose: async () => {
          disposed.push('worker')
        },
      }),
    ]

    const out = JSON.parse(await runTool()) as { result: string }

    expect(out.result).toBe('worker done')
    expect(disposed.sort(), 'one failure skipped the other member').toEqual(['explorer', 'worker'])
    const lines = write.mock.calls.map((c) => String(c[0]))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('team member explorer failed to dispose')
    expect(lines[0]).toContain('socket already closed')
    write.mockRestore()
  })

  it('test_every_member_failing_to_dispose_is_reported_each_and_never_rejects', async () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const boom = (why: string) => async () => {
      throw new Error(why)
    }
    members.list = [
      fakeMember({ name: 'explorer', dispose: boom('x') }),
      fakeMember({ name: 'worker', dispose: boom('y') }),
    ]

    const out = JSON.parse(await runTool()) as { result: string }

    expect(out.result).toBe('worker done')
    const lines = write.mock.calls.map((c) => String(c[0]))
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('explorer')
    expect(lines[1]).toContain('worker')
    write.mockRestore()
  })
})
