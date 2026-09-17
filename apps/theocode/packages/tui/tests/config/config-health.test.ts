import { describe, expect, it } from 'vitest'

import { tmpdir } from 'node:os'

import { resolveEffectiveConfig as realResolve } from '@theocode/agent/config'

import { configHealthNotice, fallbackConfigPosture } from '../../src/config-health.js'

/**
 * #827 — a settings file that cannot be read is reported on EVERY boot, not once.
 *
 * The warning lived inside `if (decision === 'yes')` in `ConsentGates.tsx` — the branch that runs
 * when trust is GRANTED. Measured 2026-09-17 with the log moved aside first, so the absence was a
 * fresh one: second run, nothing on screen, nothing in `.theokit/tui-stderr.log`, and the status bar
 * showing the default as if the operator had chosen it. `theocode doctor`, on the same file, exits 1.
 *
 * `sandbox_mode` and `approval_policy` live in that file. A confinement setting dropped without a
 * word is the failure this product's own `doctor` names one surface over.
 */
describe('configHealthNotice', () => {
  it('test_a_readable_config_says_nothing', () => {
    // A notice on every healthy boot is noise, and noise is what makes a diagnostic stop being read.
    expect(configHealthNotice(() => ({ sandbox_mode: 'read-only' }))).toBeUndefined()
  })

  it('test_an_unreadable_config_names_the_reason', () => {
    const notice = configHealthNotice(() => {
      throw new Error('malformed JSON at /p/.theokit/settings.json')
    })

    expect(notice).toContain('malformed JSON at /p/.theokit/settings.json')
  })

  it('test_it_says_settings_json_not_config_toml', () => {
    // The message used to name `config.toml`, the format `settings.json` replaced — sending a reader
    // to a file that is not the one that failed.
    const notice = configHealthNotice(() => {
      throw new Error('malformed JSON at /p/.theokit/settings.json')
    })

    expect(notice).toContain('settings.json')
    expect(notice).not.toContain('config.toml')
  })

  it('test_it_says_what_the_operator_gets_instead', () => {
    // The half that makes it actionable: the session did not stop, it fell back — and the status bar
    // will show defaults that look like a choice.
    const notice = configHealthNotice(() => {
      throw new Error('boom')
    })

    expect(notice).toMatch(/default/i)
  })
})

/**
 * A malformed settings file must not take the terminal down.
 *
 * Measured 2026-09-17, and it corrects this session's own earlier record: the first measurement said
 * the TUI "came up on defaults and said nothing", which was true only because the directory was NOT
 * yet trusted — project config is withheld there, so the broken file was never read. Once trusted,
 * `resolveEffectiveConfig` throws inside `createTuiSession` and the process dies with a stack trace
 * before the first frame.
 *
 * Confirmed pre-existing by stashing every change from this session and rebuilding: HEAD crashes
 * identically. `session-start.ts` already carries the same argument for its own path — "a hook
 * failing must not refuse a session the operator just asked for" — and this is the path it does not
 * cover.
 */
describe('a config that cannot be read', () => {
  it('test_the_session_still_starts', async () => {
    const { createTuiSession } = await import('../../src/agent-session/tui-session.js')

    const session = createTuiSession({
      cwd: '/nonexistent',
      sessionPointer: '/nonexistent/.theokit/tui-session',
      // Throws for the PROJECT directory and resolves for any other, which is the real shape: the
      // fallback reads a directory with no settings file in it. A stub that threw unconditionally
      // would assert that the fallback itself must survive an unreadable user config — a different
      // claim, and one this does not make: if every layer is unreadable there is no configuration to
      // run on, and the error belongs to the operator.
      loadConfig: (o?: { cwd?: string }) => {
        if (o?.cwd === '/nonexistent') throw new Error('malformed JSON at /p/.theokit/settings.json')
        return realResolve({ cwd: o?.cwd ?? tmpdir(), ...(o ?? {}) })
      },
    })

    expect(session.cfg(), 'the session died instead of falling back').toBeDefined()
  })

  it('test_it_falls_back_to_the_most_confined_posture', () => {
    // Not "the defaults", which would be a posture the operator never chose. Unreadable configuration
    // is unknown configuration, and the safe reading of unknown confinement is the narrow one.
    expect(fallbackConfigPosture().sandbox_mode).toBe('read-only')
  })
})
