/**
 * What `/statusline` and `/title` SAY, and — as much as it matters here — what they refuse.
 *
 * The frames these two change are asserted where they are drawn (`statusline-session.test.tsx`,
 * `title-session.test.tsx`), because that is the only place a store write can be told apart from a
 * repaint. What is left for this file is the half those cannot see: the words, and the branch that
 * declines to change anything at all.
 *
 * The refusal is not a formality. `parseItems` is all-or-nothing, and the failure it exists to
 * prevent is quiet: applying the words that parsed and dropping the rest repaints the surface,
 * reports success, and leaves the typo to be discovered by someone wondering where their sandbox
 * mode went. So each command is asserted to leave its selection UNTOUCHED on a bad word, which is a
 * different assertion from "it produced an error toast".
 *
 * Which CHANNEL answers is asserted too. A report the user has to read before typing the next
 * command belongs on a panel that waits for Esc, and a five-second toast that vanishes mid-read is
 * the failure that would otherwise be discovered by a user rather than by this file.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ContentPanel, ToastPayload } from '../../src/screen-types.js'
import { statuslineSelection } from '../../src/session-ui/statusline-session.js'
import { titleSelection } from '../../src/session-ui/title-session.js'
import { handleStatusline, handleTitle } from '../../src/commands/surface-commands.js'

/** Both answer channels, spied, so a case can assert which one was used and which was not. */
function screen() {
  const setToast = vi.fn<(t: ToastPayload) => void>()
  const setPanel = vi.fn<(p: ContentPanel) => void>()
  return {
    setToast,
    setPanel,
    toast: () => setToast.mock.calls[0]?.[0],
    panel: () => setPanel.mock.calls[0]?.[0],
  }
}

afterEach(() => {
  statuslineSelection.reset()
  titleSelection.reset()
})

describe('the bare command reports on a panel that waits to be dismissed', () => {
  it('test_bare_statusline_names_the_current_selection_and_every_item_it_could_show', () => {
    const s = screen()

    handleStatusline('', s)

    expect(
      s.setToast,
      'a report the user must read was put in a toast that auto-dismisses',
    ).not.toHaveBeenCalled()
    const body = s.panel()?.body ?? ''
    for (const item of statuslineSelection.vocabulary) {
      expect(body, `${item} exists but the report does not offer it`).toContain(item)
    }
    expect(body, 'the report does not say the default is in force').toContain('(default)')
  })

  it('test_the_report_offers_no_word_the_parser_would_then_reject', () => {
    // The panel doubles as the menu, and a menu naming a word the command turns down is worse than
    // no menu — the property `permissions-panel.ts` states for its own two knobs.
    const s = screen()
    handleStatusline('', s)
    const offered = (s.panel()?.body ?? '')
      .split('\n')
      .map((line) => line.trim().split(/\s+/)[0] ?? '')
      .filter((word) => /^[a-z]+$/.test(word))

    for (const word of offered) {
      const applied = screen()
      handleStatusline(word, applied)
      expect(
        applied.toast()?.variant,
        `the report offers "${word}" and the command refuses it`,
      ).not.toBe('error')
    }
  })

  it('test_bare_title_says_the_terminal_gets_its_own_title_back', () => {
    // The one fact a user cannot verify from inside the session and would reasonably worry about:
    // a program that rewrites the window title and never says whether it will put it back.
    const s = screen()

    handleTitle('', s)

    expect(s.panel()?.body).toContain('restored')
  })

  it('test_bare_title_reports_a_session_selection_without_calling_it_the_default', () => {
    titleSelection.select(['model'])
    const s = screen()

    handleTitle('', s)

    expect(s.panel()?.body, 'the report is still describing the default').not.toContain('(default)')
    expect(s.panel()?.body).toContain('model')
  })
})

describe('a word outside the vocabulary changes nothing', () => {
  it('test_an_unknown_statusline_item_is_refused_by_name', () => {
    const before = statuslineSelection.current()
    const s = screen()

    handleStatusline('model sandbux', s)

    expect(s.toast()?.variant, 'a refusal announced as success reads as applied').toBe('error')
    expect(s.toast()?.message, 'the refusal does not say which word failed').toContain('sandbux')
    expect(s.toast()?.message, 'the refusal does not name the vocabulary').toContain('sandbox')
    expect(
      statuslineSelection.current(),
      'the recognised half of a bad line was applied anyway',
    ).toBe(before)
  })

  it('test_an_unknown_title_item_is_refused_by_name', () => {
    const before = titleSelection.current()
    const s = screen()

    handleTitle('app branch', s)

    expect(s.toast()?.variant).toBe('error')
    expect(s.toast()?.message).toContain('branch')
    expect(titleSelection.current(), 'a partially parsed line reached the title').toBe(before)
  })
})

describe('a recognised line is applied, and says how long it lasts', () => {
  it('test_selecting_items_replaces_the_selection_in_order', () => {
    handleStatusline('auth, model', screen())

    expect(
      statuslineSelection.current(),
      'the items were reordered or the comma form was not accepted',
    ).toEqual(['auth', 'model'])
  })

  it('test_a_repeated_item_is_selected_once', () => {
    handleStatusline('model model auth', screen())

    expect(statuslineSelection.current()).toEqual(['model', 'auth'])
  })

  it('test_the_success_toast_says_the_change_is_for_this_session_only', () => {
    // The durability sentence. `memory-switch.ts` carries the argument; what matters here is that
    // it is SAID — a user told nothing assumes the wrong answer and finds out at the next launch.
    const s = screen()

    handleStatusline('model', s)

    expect(s.toast()?.variant).toBe('success')
    expect(s.toast()?.message, 'a session-only change was reported without saying so').toContain(
      'this session only',
    )
    expect(
      s.setPanel,
      'a one-line outcome opened a panel that has to be dismissed',
    ).not.toHaveBeenCalled()
  })

  it('test_default_restores_and_reports_itself_as_the_default_again', () => {
    handleStatusline('model', screen())
    const s = screen()

    handleStatusline('default', s)

    expect(statuslineSelection.isDefault(), '/statusline default left the override in place').toBe(
      true,
    )
    expect(s.toast()?.message).toContain('(default)')
  })

  it('test_title_none_selects_nothing_rather_than_being_refused_as_an_unknown_item', () => {
    // `none` has to be a word the parser never sees, or it would be reported as a typo. The
    // capability it names is real: a user who does not want their tabs rewritten must be able to
    // say so without quitting.
    const s = screen()

    handleTitle('none', s)

    expect(s.toast()?.variant).toBe('success')
    expect(titleSelection.current(), '/title none did not empty the selection').toEqual([])
  })

  it('test_an_item_name_is_matched_regardless_of_case', () => {
    // `MODEL` is what a shell-trained hand types, and calling it an unknown word would send the
    // user to fix a spelling that is already right — the reason `/theme` lower-cases too.
    handleTitle('MODEL', screen())

    expect(titleSelection.current()).toEqual(['model'])
  })
})
