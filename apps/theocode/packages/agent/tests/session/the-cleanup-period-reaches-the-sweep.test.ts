import { describe, expect, it } from 'vitest'

import { buildSweepCommand } from '../../src/session/gc/spawn-sweep.js'

/**
 * #736 — `cleanupPeriodDays` is declared HONOURED, so it has to arrive somewhere.
 *
 * The key was reported as "not implemented here" and the decision recorded for it is `honoured`,
 * because this product does keep session transcripts and does collect them on a window. A decision
 * that says honoured while nothing reads the value is the accepted-and-ignored failure with a better
 * label on it — worse than the silence it replaced, because the label is what an author checks.
 *
 * The child sweep takes `--max-age-days`; without one it uses `DEFAULT_WINDOW_DAYS = 30`, so an
 * operator asking for 7 got 30 and nothing said so.
 */
describe('the cleanup period', () => {
  const base = { apply: true, execPath: '/usr/bin/node', script: '/app/cli.mjs' }

  it('test_it_reaches_the_child_that_actually_deletes', () => {
    const cmd = buildSweepCommand({ ...base, maxAgeDays: 7 })

    expect(cmd.args, 'the window the operator asked for must reach the sweep').toContain(
      '--max-age-days',
    )
    expect(cmd.args[cmd.args.indexOf('--max-age-days') + 1]).toBe('7')
  })

  it('test_without_one_the_command_is_unchanged', () => {
    // The control: an absent key must leave the command exactly as it was, so a project that never
    // wrote the key keeps the default rather than inheriting a number from this wiring.
    const cmd = buildSweepCommand(base)

    expect(cmd.args).not.toContain('--max-age-days')
  })
})
