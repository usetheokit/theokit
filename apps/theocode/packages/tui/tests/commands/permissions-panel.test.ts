/**
 * `/permissions` — the posture read as ONE thing, which is the only way it is legible.
 *
 * Approval and sandbox were readable only apart, and apart they mislead in both directions:
 * `full-auto` looks reckless until you see `read-only` under it, and `suggest` looks safe under
 * `danger-full-access`. The panel exists to remove that inference, so the cases below pin that both
 * values reach the screen and that the panel renders the values it is GIVEN — a hard-coded posture
 * would be worse than no panel, because it would be believed.
 *
 * The second thing pinned is the vocabulary. A panel is read as a menu, and this one offers words
 * that `/approval` and `/sandbox` then have to accept; the case that walks the rendered lists back
 * through the parsers is what stops a rename upstream from turning this into a lie.
 */
import { describe, expect, it } from 'vitest'

import { parseApprovalMode } from '../../src/consent/index.js'
import { parseSandboxMode } from '../../src/commands/sandbox-command.js'
import { permissionsPanel } from '../../src/commands/permissions-panel.js'

/** The values the panel offers for a knob, read back out of what it rendered. */
function offered(body: string, knob: string): string[] {
  const line = body.split('\n').find((l) => l.includes(`/${knob} <`))
  const inside = /<([^>]+)>/.exec(line ?? '')?.[1]
  expect(inside, `the panel offers no values for /${knob}`).toBeDefined()
  return (inside ?? '').split(' | ')
}

describe('the permissions panel shows both halves of the disk decision', () => {
  it('test_it_reports_the_approval_mode_and_the_sandbox_mode_together', () => {
    const body = permissionsPanel('full-auto', 'read-only').body

    expect(body, 'the approval mode is missing').toContain('full-auto')
    expect(body, 'the sandbox mode is missing — the half that makes the other legible').toContain(
      'read-only',
    )
  })

  it('test_it_renders_the_posture_it_is_given_rather_than_a_fixed_one', () => {
    // Anti-vacuity for the case above: a panel with the modes typed into it would satisfy that one
    // for exactly one posture and quietly misreport every other.
    expect(permissionsPanel('suggest', 'workspace-write').body).not.toBe(
      permissionsPanel('full-auto', 'danger-full-access').body,
    )
  })

  it('test_the_unenforced_sandbox_warning_reaches_the_panel', () => {
    // The single most consequential string on this screen: it says the confinement the approval
    // mode is trusting is not actually in force. `sandboxDetail` carries it; `sandboxLabel` does
    // not, which is why the panel is fed the former.
    expect(permissionsPanel('full-auto', 'danger-full-access ⚠ tool-gating').body).toContain(
      '⚠ tool-gating',
    )
  })

  it('test_it_names_the_command_that_changes_each_knob', () => {
    // The panel is deliberately read-only. Someone who opened it to change something has to leave
    // knowing where the setter is, or the screen is a dead end.
    const body = permissionsPanel('suggest', 'read-only').body

    expect(body).toContain('/approval <')
    expect(body).toContain('/sandbox <')
  })
})

describe('the permissions panel offers only values the setters accept', () => {
  it('test_every_approval_value_it_lists_is_one_the_parser_takes', () => {
    for (const value of offered(permissionsPanel('suggest', 'read-only').body, 'approval')) {
      expect(parseApprovalMode(value), `/approval would reject the offered "${value}"`).toBe(value)
    }
  })

  it('test_every_sandbox_value_it_lists_is_one_the_parser_takes', () => {
    for (const value of offered(permissionsPanel('suggest', 'read-only').body, 'sandbox')) {
      expect(parseSandboxMode(value), `/sandbox would reject the offered "${value}"`).toBe(value)
    }
  })

  it('test_it_lists_more_than_one_value_per_knob', () => {
    // Anti-vacuity for the two cases above: an empty or single-entry list would pass them both
    // while hiding every mode the user could actually move to.
    const body = permissionsPanel('suggest', 'read-only').body

    expect(offered(body, 'approval').length).toBeGreaterThan(1)
    expect(offered(body, 'sandbox').length).toBeGreaterThan(1)
  })
})
