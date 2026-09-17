import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { openTui } from './drive.js'

/**
 * Driving the TUI must not reach the machine it is driven on.
 *
 * `every-command.test.tsx` runs all 46 commands, `/logout` among them, and `handleLogout` calls
 * `logout(homedir())`. The harness mounts the real `<App />` IN THIS PROCESS, so `homedir()` is the
 * operator's own home.
 *
 * Measured 2026-09-17, by accident, in the middle of an unrelated parity run: a credential obtained
 * minutes earlier was gone after `npm test`. Reproduced with a decoy — a generic file in the same
 * directory survived, `auth.json` did not — and narrowed to this suite, which PASSES while doing it
 * (5 passed, exit 0). Every developer who runs the suite is logged out, and nothing says why.
 *
 * The fix belongs in the harness rather than in `/logout`: the defect is a suite that drives every
 * command against the real environment, so the next destructive command would land the same way.
 */
// Captured at module load, BEFORE any harness runs. `os.homedir()` reads `$HOME`, so once the
// harness has isolated it, calling `homedir()` returns the isolated one — a first version of the
// assertion below compared that value with itself and could never fail.
const OPERATOR_HOME = homedir()

describe('the TUI harness', () => {
  const sentinel = join(OPERATOR_HOME, '.theocode', 'auth.json')
  const preexisting = existsSync(sentinel)

  afterAll(() => {
    // Never leave a file behind in someone's home that this test invented.
    if (!preexisting && existsSync(sentinel)) {
      throw new Error(`the harness created ${sentinel}; it must not write to the operator's home`)
    }
  })

  it('test_it_reports_a_home_that_is_not_the_operators', async () => {
    const tui = await openTui()
    try {
      expect(process.env.HOME).toBeDefined()
      expect(process.env.HOME).not.toBe(OPERATOR_HOME)
    } finally {
      tui.stop()
    }
  })

  it('test_logout_cannot_remove_the_operators_credential', async () => {
    mkdirSync(join(OPERATOR_HOME, '.theocode'), { recursive: true })
    if (!preexisting) writeFileSync(sentinel, '{"sentinel":true}\n', { mode: 0o600 })

    const tui = await openTui()
    try {
      await tui.type('/logout')
      await tui.submit()
    } finally {
      tui.stop()
    }

    expect(existsSync(sentinel), 'the suite removed the credential in the operator home').toBe(true)
  })
})
