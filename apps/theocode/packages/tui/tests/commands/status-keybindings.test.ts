/**
 * `/status` names what a `~/.claude/keybindings.json` asked for and did not get.
 *
 * The row exists because everything else about a keybindings file is silent by construction: an
 * unhonoured binding is a key that does nothing, which reads as a broken terminal rather than as an
 * unsupported action. The operator with that file is running the TUI, so the answer belongs where
 * they already read the theme decision — not in `theocode doctor`, which the CLI owns and which
 * must not start depending on the TUI (`theme-base.ts` records the same boundary).
 */
import { describe, expect, it } from 'vitest'

import { keybindingsRow } from '../../src/commands/command-content.js'

describe('the keybindings row', () => {
  it('test_it_names_what_was_not_applied', () => {
    expect(keybindingsRow(['"shift+tab": this product matches ctrl+<letter> only'])).toContain(
      'shift+tab',
    )
  })

  it('test_a_file_fully_honoured_says_so_rather_than_going_quiet', () => {
    // A row that disappears is indistinguishable from a row nobody wrote. `/status` is a fixed set
    // of labels, so this one answers either way.
    expect(keybindingsRow([])).not.toContain('not applied')
  })

  it('test_it_says_how_many_when_the_list_is_long', () => {
    // Anti-noise: a `/status` panel is read at a glance and a twenty-item list would push the rows
    // below it off the screen. The count is the part that makes an operator go and look.
    const many = Array.from({ length: 7 }, (_, i) => `"ctrl+${String(i)}": nope`)
    expect(keybindingsRow(many)).toContain('7')
  })
})
