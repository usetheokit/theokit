import { describe, expect, it, vi } from 'vitest'

import { SHUTDOWN_EXIT_CODES, createShutdown } from '../../src/commands/shutdown.js'

/**
 * M83 — orderly shutdown, with a watchdog.
 *
 * The contract the milestone names: a clean Ctrl-C, a cleanup that FAILED, and a cleanup that HUNG
 * have to stay distinguishable. Collapsing them makes a hung cleanup look like a user pressing
 * Ctrl-C — and the hang reads as normal operation forever.
 */

describe('cleanups run in order, and the outcome is clean', () => {
  it('test_every_cleanup_runs_in_registration_order', async () => {
    const order: string[] = []
    const shutdown = createShutdown()
    shutdown.register({
      name: 'a',
      run: () => {
        order.push('a')
      },
    })
    shutdown.register({
      name: 'b',
      run: () => {
        order.push('b')
      },
    })

    await expect(shutdown.run()).resolves.toBe('clean')
    expect(order).toEqual(['a', 'b'])
  })

  it('test_a_clean_exit_uses_the_SIGINT_convention', async () => {
    // 130 is `128 + 2`, the shell convention for SIGINT, so a CI job that treats it as "user
    // cancelled" keeps working.
    const exit = vi.fn()
    await createShutdown({ exit }).run()
    expect(exit).toHaveBeenCalledWith(SHUTDOWN_EXIT_CODES.clean)
    expect(SHUTDOWN_EXIT_CODES.clean).toBe(130)
  })
})

describe('a failing cleanup is distinguishable, and does not strand the others', () => {
  it('test_a_later_cleanup_still_runs_after_one_throws', async () => {
    // One broken release must not leak every resource registered after it.
    const after = vi.fn()
    const shutdown = createShutdown()
    shutdown.register({
      name: 'broken',
      run: () => {
        throw new Error('nope')
      },
    })
    shutdown.register({ name: 'after', run: after })

    await expect(shutdown.run()).resolves.toBe('cleanup-failed')
    expect(after).toHaveBeenCalledTimes(1)
  })

  it('test_the_failure_is_reported_with_the_cleanup_NAME', async () => {
    const onWarn = vi.fn()
    const shutdown = createShutdown({ onWarn })
    shutdown.register({
      name: 'transcript-flush',
      run: () => {
        throw new Error('disk full')
      },
    })
    await shutdown.run()
    expect(onWarn).toHaveBeenCalledWith(expect.stringContaining('transcript-flush'))
  })

  it('test_its_exit_code_differs_from_a_clean_one', async () => {
    expect(SHUTDOWN_EXIT_CODES['cleanup-failed']).not.toBe(SHUTDOWN_EXIT_CODES.clean)
  })
})

describe('the watchdog bounds a HUNG cleanup', () => {
  it('test_a_cleanup_that_never_settles_fires_the_watchdog', async () => {
    const shutdown = createShutdown({ watchdogMs: 20 })
    shutdown.register({ name: 'hangs', run: () => new Promise<void>(() => undefined) })
    await expect(shutdown.run()).resolves.toBe('watchdog-timeout')
  })

  it('test_the_timeout_names_which_cleanup_is_still_pending', async () => {
    // "shutdown timed out" sends an operator hunting; "still waiting on: transcript-flush" sends
    // them to the code.
    const onWarn = vi.fn()
    const shutdown = createShutdown({ watchdogMs: 20, onWarn })
    shutdown.register({ name: 'transcript-flush', run: () => new Promise<void>(() => undefined) })
    await shutdown.run()
    expect(onWarn).toHaveBeenCalledWith(expect.stringContaining('transcript-flush'))
  })

  it('test_all_three_exit_codes_are_distinct', () => {
    // The contract, asserted directly: a hung cleanup must not be reportable as a user's Ctrl-C.
    const codes = Object.values(SHUTDOWN_EXIT_CODES)
    expect(new Set(codes).size).toBe(codes.length)
  })
})

describe('a second Ctrl-C does not start a second teardown', () => {
  it('test_run_is_idempotent', async () => {
    // A double release over the same resources turns a clean exit into a crash — and the second
    // Ctrl-C is exactly what an impatient user does while teardown is in flight.
    const run = vi.fn()
    const shutdown = createShutdown()
    shutdown.register({ name: 'once', run })

    await Promise.all([shutdown.run(), shutdown.run()])
    expect(run).toHaveBeenCalledTimes(1)
  })
})

describe('signals are injected, never installed by the module', () => {
  it('test_both_SIGINT_and_SIGTERM_get_a_handler', () => {
    // Injected because a module calling `process.on`/`process.exit` directly cannot be tested — the
    // first assertion kills the runner, so the version that ships is the version nobody ran.
    const onSignal = vi.fn()
    createShutdown({ onSignal })
    expect(onSignal.mock.calls.map((c) => c[0])).toEqual(['SIGINT', 'SIGTERM'])
  })
})
