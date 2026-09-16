/**
 * `/theme` used to be a pointer at `/status`, then a report that refused every argument; it
 * switches now, and the risk moved again.
 *
 * A reporting command had two ways to fail its user: under-report — say `dark` without saying that
 * a `THEOCODE_THEME=drak` was thrown away to get there — or over-claim, by accepting `light` and
 * changing nothing. A SWITCHING command keeps both and adds a third: it can change the base and
 * then describe the session as though the environment had decided it, which sends the next person
 * to debug a `THEOCODE_THEME` that was never involved.
 *
 * The pure line is tested against CRAFTED resolutions rather than the ambient one: `NO_COLOR` set
 * in a terminal running the suite would otherwise decide half of these cases. That the switch
 * reaches the RENDERED provider is a separate proof and lives in `theme-session.test.tsx` — a test
 * that only watched this module's state would pass against a base the frame never reads.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { statusPanel } from '../../src/commands/command-content.js'
import type { PtysTheInterpreterUses, SessionTheInterpreterUses } from '../../src/commands/command-capabilities.js'
import type { ToastPayload } from '../../src/screen-types.js'
import { THEME_BASES } from '../../src/theme/theme-base.js'
import { resetSessionThemeForTest, sessionThemeLabel } from '../../src/theme/theme-session.js'
import { THEME_RESOLUTION } from '../../src/theme/theme.js'
import { handleTheme, themeResolutionLine } from '../../src/commands/theme-command.js'

/** The one toast a call produces, or a failure that says the command was silent. */
/** Where a `/theme` switch was told it landed, so a test can assert persistence without a real home. */
let persisted: string[] = []
let writeSucceeds = true

function toastOf(arg: string): ToastPayload {
  const setToast = vi.fn()
  handleTheme(
    arg,
    setToast,
    // #72 — injected. Before this seam existed, running this suite wrote a `tui-theme` file into the
    // home of whoever ran it, silently changing the colour they would see at their next launch.
    (base) => {
      persisted.push(base)
      return writeSucceeds
    },
    () => '<store>',
  )
  const payload = setToast.mock.calls[0]?.[0] as ToastPayload | undefined
  expect(payload, `/theme ${arg} said nothing at all`).toBeDefined()
  return payload as ToastPayload
}

/**
 * B-161: the panel reads the rules off disk when it is given no wiring record, so a checkout that
 * has `.claude/rules/` covers a line a clean one does not — and the suite's coverage total then
 * depends on the machine. The record is a parameter for the reason `rulesRow`'s own comment gives;
 * passing it is what keeps both the row and the coverage independent of where the suite runs.
 */
const NO_RULES = {
  // `agentsMd` is required by the type: `agentsMdRow` reads it unguarded, so a record without it
  // crashes the panel. The cast is the file's existing idiom for a partial record; it must still
  // carry every field the panel actually reads.
  agentsMd: { active: [], requested: [], suppressedByTrust: false },
  rules: { count: 0, read: 0 },
} as unknown as Parameters<typeof statusPanel>[4]

/** The `theme` row of `/status`, or `undefined` if the panel stopped carrying one. */
function statusThemeRow(): string | undefined {
  const session = {
    attachImages: vi.fn(),
    effort: () => 'medium' as never,
    setEffort: vi.fn(),
    cfg: () => ({ modelLabel: 'm', sandboxLabel: 's', sandboxDetail: 'read-only', memory: false }),
    sessionModel: () => undefined,
    setSessionModel: vi.fn(),
    setModel: vi.fn(),
    session: () => 'tui-1',
  } satisfies SessionTheInterpreterUses
  const ptys = {
    backend: () => ({ activeSessionCount: () => 0, killAll: vi.fn() }),
  } as unknown as PtysTheInterpreterUses

  return statusPanel(session, 'suggest', () => 'tui-1', ptys, NO_RULES)
    .body.split('\n')
    .find((row) => row.startsWith('theme:'))
}

// The override is process-wide, exactly like the switch it models. Left in place it would leak into
// whichever test ran next and quietly turn its "no override" case into a passing tautology.
afterEach(() => {
  resetSessionThemeForTest()
})

describe('the active theme is reported with the input that decided it', () => {
  it('test_the_line_names_the_base_and_the_source', () => {
    expect(themeResolutionLine({ base: 'no-color', source: 'NO_COLOR' })).toBe(
      'no-color (NO_COLOR)',
    )
  })

  it('test_a_rejected_value_is_named_together_with_what_was_expected', () => {
    // The resolver falls back so a typo in a cosmetic knob cannot end the session. This line is
    // the only thing that keeps that fallback from being a swallowed error: without it the user
    // sees `dark` and no trace of the word they actually typed.
    const line = themeResolutionLine({ base: 'dark', source: 'default', invalid: 'drak' })

    expect(line, 'the rejected value is not shown').toContain('drak')
    expect(line, 'the user is not told what would have been accepted').toContain(
      THEME_BASES.join(' | '),
    )
  })

  it('test_a_clean_resolution_carries_no_rejection_clause', () => {
    // Anti-vacuity for the case above: a line that always appended the vocabulary would satisfy it
    // while telling every user that something of theirs was ignored.
    expect(themeResolutionLine({ base: 'light', source: 'THEOCODE_THEME' })).toBe(
      'light (THEOCODE_THEME)',
    )
  })

  it('test_a_session_override_is_reported_as_the_active_base', () => {
    // The fact the row exists to carry. Reporting the environment's answer while the frame is drawn
    // in another base is a lie the user can see on screen and not in the panel.
    const line = themeResolutionLine({ base: 'dark', source: 'default' }, 'light')

    expect(line, 'the active base is not the one being drawn').toMatch(/^light\b/)
    expect(line, 'the override is not attributed to /theme').toContain('/theme')
  })

  it('test_a_session_override_still_names_what_the_environment_resolves', () => {
    // The second fact, and the reason the line takes two arguments instead of one. A user who has
    // forgotten they typed `/theme` must still be able to tell a switch they made from an
    // environment they need to go and fix.
    const line = themeResolutionLine({ base: 'dark', source: 'THEOCODE_THEME' }, 'no-color')

    expect(line, 'the environment resolution was dropped').toContain('dark (THEOCODE_THEME)')
  })

  it('test_the_status_panel_reports_the_same_line_as_the_theme_command', () => {
    // Anti-drift. Two renderers for one resolution is how `/status` and `/theme` come to disagree
    // about which input decided the colour — the single question anyone asks about a theme.
    const themeRow = statusThemeRow()

    expect(themeRow, 'the theme row vanished from /status').toBeDefined()
    expect(themeRow).toContain(themeResolutionLine(THEME_RESOLUTION, sessionThemeLabel()))
    expect(toastOf('')).toMatchObject({
      message: expect.stringContaining(
        themeResolutionLine(THEME_RESOLUTION, sessionThemeLabel()),
      ) as unknown as string,
    })
  })

  it('test_the_status_row_follows_a_switch_rather_than_the_environment', () => {
    // `/status` and `/theme` read the override through the same accessor, so this is what catches a
    // panel that keeps rendering the startup resolution after the frame has been repainted.
    const before = statusThemeRow()
    const other = THEME_BASES.find((base) => base !== THEME_RESOLUTION.base)

    handleTheme(other as string, vi.fn(), () => true, () => '<store>')

    expect(statusThemeRow(), 'the /status theme row ignored the switch').not.toBe(before)
    expect(statusThemeRow(), 'the row does not name the base now being drawn').toMatch(
      new RegExp(`theme:\\s+${other as string}\\b`),
    )
  })
})

describe('a theme this build can switch to is applied rather than explained away', () => {
  it('test_the_bare_report_says_how_the_theme_is_set_at_all', () => {
    const toast = toastOf('')

    expect(toast.variant, 'a plain report was raised as a failure').toBe('info')
    expect(toast.message, 'the report does not name the variable that sets the default').toContain(
      'THEOCODE_THEME',
    )
    for (const base of THEME_BASES) {
      expect(toast.message, `${base} is not offered as a value`).toContain(base)
    }
  })

  it('test_a_bare_report_changes_nothing', () => {
    // Anti-vacuity for every switching case below: a handler that set the base on any input at all
    // would pass them and would also repaint the frame for someone who only asked a question.
    toastOf('')

    expect(sessionThemeLabel(), '/theme with no argument switched the theme').toBeUndefined()
  })

  it('test_a_valid_theme_is_applied_to_the_session', () => {
    toastOf('light')

    expect(sessionThemeLabel(), '/theme light did not switch the base').toBe('light')
  })

  it('test_the_switch_is_reported_as_performed_and_as_remembered', () => {
    // Both halves are load-bearing. An `error` variant on a switch that worked reads as a failure;
    // silence about durability leaves the user guessing which of the two happened.
    persisted = []
    writeSucceeds = true
    const toast = toastOf('no-color')

    expect(toast.variant, 'a switch that worked was announced as a failure').toBe('success')
    expect(toast.message, 'the new base is not named back').toContain('no-color')
    expect(persisted, 'the switch was not written anywhere').toEqual(['no-color'])
    expect(toast.message, 'the message does not say the switch outlives the session').toContain(
      'next launch',
    )
    expect(toast.message, 'the override that still wins is not named').toContain('THEOCODE_THEME')
  })

  it('test_a_write_that_failed_is_said_so_rather_than_promised', () => {
    // The one outcome worse than not persisting: telling the operator it persisted when it did not.
    persisted = []
    writeSucceeds = false
    const toast = toastOf('light')

    expect(toast.message, 'a failed write was reported as remembered').toContain('this session only')
    expect(toast.message, 'the file that could not be written is not named').toContain('<store>')
  })

  it('test_an_uppercase_value_is_applied_rather_than_called_a_typo', () => {
    // `DARK` is the value, typed the way a shell exports it. Refusing it would send the user to fix
    // a spelling that is already right.
    const toast = toastOf('LIGHT')

    expect(toast.variant).toBe('success')
    expect(sessionThemeLabel(), 'an upper-case base was not applied').toBe('light')
  })

  it('test_an_unrecognised_theme_is_refused_by_naming_the_vocabulary', () => {
    const toast = toastOf('drak')

    expect(toast.variant).toBe('error')
    expect(toast.message, 'the unusable word is not quoted back').toContain('drak')
    expect(toast.message, 'the accepted values are not listed').toContain(THEME_BASES.join(' | '))
  })

  it('test_an_unrecognised_theme_leaves_the_active_base_alone', () => {
    // The refusal has to be a refusal. A handler that said "not a theme" and then stored the word
    // anyway would satisfy the message assertions above and hand `THEMES[base]` an `undefined`.
    handleTheme('light', vi.fn(), () => true, () => '<store>')
    handleTheme('drak', vi.fn(), () => true, () => '<store>')

    expect(sessionThemeLabel(), 'a rejected word replaced the base that was working').toBe('light')
  })
})

/**
 * #14 — `/theme custom:<slug>` repaints the frame, and both reports used to look straight past it.
 *
 * `sessionThemeBase()` answered "which of the three BUILT-IN bases did `/theme` pick", and returned
 * `undefined` after a custom selection — so `/status` and `/theme` were handed no override at all
 * and reported the environment's answer while the terminal was drawn in the operator's own file.
 * The worst of the three outputs was `/theme` listing that very file under "also", i.e. as one
 * still available to switch to.
 *
 * `sessionThemeLabel()` is the fact both reports actually want, and its own docblock said so; it
 * had no production caller.
 */
describe('#14 — the custom theme in force is what the reports name', () => {
  let home: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'theocode-theme-report-'))
    mkdirSync(join(home, '.claude', 'themes'), { recursive: true })
    writeFileSync(
      join(home, '.claude', 'themes', 'midnight.json'),
      JSON.stringify({ name: 'Midnight', base: 'dark' }),
    )
  })
  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  const NEVER_PERSISTED = (): boolean => false
  const STORE = (): string => '<store>'

  const select = (): void => {
    handleTheme('custom:midnight', vi.fn(), NEVER_PERSISTED, STORE, home)
  }
  const bareReport = (): string => {
    const setToast = vi.fn()
    handleTheme('', setToast, NEVER_PERSISTED, STORE, home)
    return (setToast.mock.calls[0]?.[0] as ToastPayload).message
  }

  it('test_status_names_the_custom_theme_rather_than_the_environment_base', () => {
    select()

    expect(statusThemeRow(), 'the /status theme row never names the theme being drawn').toContain(
      'custom:midnight',
    )
  })

  it('test_the_bare_report_attributes_the_custom_theme_to_the_session', () => {
    select()

    expect(bareReport()).toContain('custom:midnight (/theme, this session)')
  })

  it('test_the_theme_in_force_is_not_offered_as_one_still_available', () => {
    select()

    expect(
      bareReport(),
      'the theme being drawn was listed under "also", as one still available',
    ).not.toMatch(/also[^\n]*custom:midnight/)
  })

  it('test_a_custom_theme_that_is_not_in_force_is_still_offered', () => {
    // Anti-vacuity floor: dropping the whole "also" clause would satisfy the case above while
    // making the feature undiscoverable again.
    writeFileSync(
      join(home, '.claude', 'themes', 'solar.json'),
      JSON.stringify({ name: 'Solar', base: 'light' }),
    )
    select()

    expect(bareReport()).toMatch(/also[^\n]*custom:solar/)
  })
})
