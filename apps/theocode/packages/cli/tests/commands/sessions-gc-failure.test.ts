/**
 * `exitAfterDrain` does not stop execution, so a failing `sessions gc` must return after it rather
 * than fall through to the report with no outcome.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@theokit/agents', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  Agent: {
    list: () => Promise.reject(new Error('registry down')),
    delete: () => Promise.resolve(),
  },
}))

import { sessionsCommand } from '../../src/commands/sessions.js'

describe('sessions gc failure', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    process.exitCode = undefined
  })

  it('test_a_failed_plan_prints_the_gc_error_and_does_not_throw', async () => {
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    await expect(
      sessionsCommand({ action: 'gc', apply: false, json: false } as never),
    ).resolves.toBeUndefined()
    const out = err.mock.calls.map((c) => String(c[0])).join('')
    expect(out).toContain('[sessions gc] registry down')
    expect(process.exitCode).toBe(1)
  })
})
