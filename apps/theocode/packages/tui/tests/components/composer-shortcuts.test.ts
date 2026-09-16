/**
 * B-028 — the help panel does not advertise a shortcut this build has not wired.
 *
 * B-006 — the derivation moved to `@theokit/tui` (`composerShortcutsFor`). These assertions are
 * the ones B-028 wrote; only the CALL changed. That is deliberate: a test written after the swap
 * proves the swap agrees with itself, while a test that predates it proves the library form
 * preserves the behaviour.
 */
import { DEFAULT_COMPOSER_SHORTCUTS, composerShortcutsFor } from '@theokit/tui'
import { describe, expect, it } from 'vitest'

import { THIS_BUILD } from '../../src/components/composer-capabilities.js'

const keysOf = (list: readonly { keys: string }[]): string[] => list.map((s) => s.keys)

describe('B-028 — the help lists what this build wires', () => {
  it('test_the_shell_shortcut_is_hidden_when_it_is_not_wired', () => {
    expect(
      keysOf(composerShortcutsFor(THIS_BUILD)),
      'the panel advertised `!` while ChatComposer had no onShellCommand, so `!npm test` went to ' +
        'the model as prose',
    ).not.toContain('!')
  })

  it('test_the_shell_shortcut_is_shown_once_it_is_wired', () => {
    // Anti-vacuity floor, and the contract for whoever closes B-056: the filter is keyed on the
    // capability, so wiring the handler restores the line with no edit here.
    expect(keysOf(composerShortcutsFor({ ...THIS_BUILD, shell: true }))).toContain('!')
  })

  it('test_every_other_shortcut_survives', () => {
    // The panel must lose exactly one line, not become a curated subset nobody maintains.
    //
    // B-006 — this is now the load-bearing assertion of the adoption. The library gates FOUR keys
    // where the local filter gated one, so a minimal declaration would silently drop `?`, `/` and
    // `@`. This fails in both directions: under-declaring hides working rows, over-declaring
    // advertises unwired ones.
    const hidden = keysOf(DEFAULT_COMPOSER_SHORTCUTS).filter(
      (k) => !keysOf(composerShortcutsFor(THIS_BUILD)).includes(k),
    )
    expect(hidden).toEqual(['!'])
  })

  it('test_the_declaration_matches_what_the_composer_is_given', () => {
    // The declaration is a claim about ConversationSlot's <ChatComposer/> props. Measured there:
    //
    //   onHelpToggle={() => setShowHelp(...)}          -> help: true
    //   commands={composerCommands(customCommands)}    -> commands: true (always spreads BUILTIN_COMMANDS)
    //   no onShellCommand                              -> shell absent (ADR 0001)
    //   no fileSearch                                  -> mentions TRUE, not absent
    //
    // The last line is the one that reads wrong and is right. `ChatComposer` declares
    // `fileSearch = defaultFileSearch` (chat-composer.tsx:303), so omitting the prop installs a
    // .gitignore-aware cwd walk rather than disabling mentions. The library's own docstring says
    // "a mention provider is passed", which is the wrong predicate — following it literally would
    // drop the `@` row for an affordance that works. B-071 carries the upstream correction.
    expect(THIS_BUILD).toEqual({ help: true, commands: true, mentions: true })
    expect(THIS_BUILD).not.toHaveProperty('shell', true)
  })
})
