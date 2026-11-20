import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { reviewCommand } from '../../src/commands/review.js'

/** A project directory of the test's own: the build is refused before it reads it, but never the checkout (B-161). */
const project = mkdtempSync(join(tmpdir(), 'drained-exit-'))
afterAll(() => {
  rmSync(project, { recursive: true, force: true })
})

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
    const shutdown = {
      register: () => () => undefined,
      run: () => Promise.resolve('clean' as const),
    }
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

describe('run and goal end through the framework drain', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    vi.resetModules()
    vi.doUnmock('node:fs')
    vi.doUnmock('../../src/run-composition.js')
    vi.doUnmock('@theocode/agent/auth')
    vi.doUnmock('@theocode/agent/chat')
    process.exitCode = undefined
  })

  const shutdown = {
    register: () => () => undefined,
    run: () => Promise.resolve('clean' as const),
  }

  it('test_run_with_an_empty_stdin_prompt_records_1_and_exits_after_the_drain_cap', async () => {
    vi.doMock('node:fs', async (orig) => ({
      ...(await orig<typeof import('node:fs')>()),
      readFileSync: () => '',
    }))
    const { runCommand } = await import('../../src/commands/run.js')
    vi.useFakeTimers()
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    await runCommand({ stdinBehavior: 'required', overrides: [] } as never, shutdown as never)
    expect(process.exitCode).toBe(1)
    expect(exit).not.toHaveBeenCalled()
    vi.advanceTimersByTime(3_000)
    expect(exit).toHaveBeenCalledWith(1)
  })

  it('test_goal_failure_records_1_and_exits_after_the_drain_cap', async () => {
    vi.doMock('../../src/run-composition.js', () => ({
      resolveCompositionContext: () => ({
        cwd: project,
        env: {},
        posture: {},
        cfg: { model: 'm', goal_oracle: 'judge' },
      }),
      routeRequestedModel: () => 'm',
    }))
    vi.doMock('@theocode/agent/auth', () => ({
      resolveCredentialForModel: () => Promise.resolve({ apiKey: 'k' }),
      routeToCredential: () => ({}),
    }))
    vi.doMock('@theocode/agent/chat', () => ({
      buildChatAgent: () => Promise.reject(new Error('boom-1920')),
    }))
    const { goalCommand } = await import('../../src/commands/goal.js')
    vi.useFakeTimers()
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    await goalCommand({ goal: 'g', overrides: [] } as never, shutdown as never)
    expect(String(err.mock.calls.flat())).toContain('boom-1920')
    expect(process.exitCode).toBe(1)
    expect(exit).not.toHaveBeenCalled()
    vi.advanceTimersByTime(3_000)
    expect(exit).toHaveBeenCalledWith(1)
  })
})
