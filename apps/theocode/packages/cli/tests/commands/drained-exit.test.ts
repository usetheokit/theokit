import { afterEach, describe, expect, it, vi } from 'vitest'
import { reviewCommand } from '../../src/commands/review.js'

describe('headless commands end through the framework drain', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    process.exitCode = undefined
  })

  it('test_review_records_the_exit_code_and_forces_exit_only_after_the_drain_cap', async () => {
    vi.useFakeTimers()
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const shutdown = { register: () => () => undefined, run: () => Promise.resolve('clean' as const) }
    await reviewCommand(
      { overrides: ['approval_policy=never'], json: false, target: {} } as never,
      shutdown as never,
    )
    expect(process.exitCode).toBe(2)
    expect(exit).not.toHaveBeenCalled()
    vi.advanceTimersByTime(3_000)
    expect(exit).toHaveBeenCalledWith(2)
  })
})
