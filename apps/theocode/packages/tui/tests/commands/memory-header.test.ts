/**
 * The `/memory` panel must agree with the memory that actually runs.
 *
 * Real memory is the AND of THREE facts (`chat.ts`):
 *
 *     posture.allows.memory && cfg.memory === true && memoryEnabledForSession()
 *
 * The header consulted two of them and reported `Memory ON` on the strength of that. Measured in the
 * running TUI on 2026-09-02, with the shipped default `memory: false`: the panel said
 * `Memory ON — …/.theokit/memory/MEMORY.md`, a fact was dictated with "Remember: …", and **nothing was
 * written** — no `MEMORY.md` was ever created.
 *
 * A panel that overstates is the defect this release already fixed once, in `/status`'s untrusted row
 * (`NOT LOADED` while a user layer WAS loaded). The failure mode is the same and so is the cost: a
 * reader who checks the panel stops checking anything else.
 *
 * The `cfg.memory === false` case gets its own wording rather than reusing the session one. Telling a
 * user `/memory on to resume` when the switch is not what is off would send them to a command that
 * cannot help them.
 */
import { describe, expect, it } from 'vitest'

import { memoryHeader } from '../../src/commands/session-commands.js'

describe('memoryHeader', () => {
  it('test_config_off_is_reported_as_off_not_as_on', () => {
    // The defect: this returned `Memory ON` while nothing could be written.
    const header = memoryHeader({ trusted: true, configured: false, sessionOn: true })
    expect(header).toMatch(/off/i)
    expect(header).not.toMatch(/Memory ON/)
  })

  it('test_config_off_names_the_config_not_the_session_switch', () => {
    // Anti-vacuity in the direction that matters: any "off" string would pass the case above, and
    // pointing at `/memory on` when the SWITCH is not what is off is a wrong instruction.
    const header = memoryHeader({ trusted: true, configured: false, sessionOn: true })
    expect(header).toMatch(/config|memory = true|settings/i)
  })

  it('test_all_three_true_is_the_only_on', () => {
    expect(memoryHeader({ trusted: true, configured: true, sessionOn: true })).toMatch(/Memory ON/)
  })

  it('test_each_false_factor_still_reports_its_own_reason', () => {
    // The three are distinguishable, because the fix for each is different: trust a directory,
    // set a config key, or flip a session switch.
    expect(memoryHeader({ trusted: false, configured: true, sessionOn: true })).toMatch(/untrusted/i)
    expect(memoryHeader({ trusted: true, configured: true, sessionOn: false })).toMatch(
      /this session/i,
    )
  })
})
