/**
 * `~/.claude/keybindings.json` — Claude Code's file, read for the gestures this product actually has.
 *
 * Format measured against `code.claude.com/docs/en/keybindings.md` on 2026-09-07:
 * `{ bindings: [{ context, bindings: { "<keystroke>": "<action>" | null } }] }`, `+` between
 * modifiers, chords separated by spaces, and seven reserved keystrokes that cannot be rebound.
 *
 * ## The measurement that decided the size of this
 *
 * This product has no key→action table to rebind. `input-router.ts` COMPUTES the action from the
 * screen state: Escape is a dismiss ladder whose meaning is the visual stacking order, and Ctrl-C
 * means abandon, interrupt, arm-exit or quit depending on five state fields. Three keys total.
 *
 * So what is rebindable is the small set of gestures that are unconditional — a key that means one
 * thing regardless of what is on screen. That set is DECLARED (`REBINDABLE`) rather than inferred,
 * and every binding the file asks for outside it is reported by name. A loader that silently
 * accepted the other fourteen actions would be promising a table this product does not have.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  CLAIMED_BY_ROUTER,
  loadKeybindings,
  REBINDABLE,
  RESERVED_FOR_REFERENCE,
} from '../../src/terminal-io/keybindings.js'

let home: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'theocode-keys-'))
  mkdirSync(join(home, '.claude'), { recursive: true })
})
afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

function bindings(body: unknown): void {
  writeFileSync(join(home, '.claude', 'keybindings.json'), JSON.stringify(body))
}

describe('reading the file', () => {
  it('test_a_binding_for_a_gesture_this_product_has_is_honoured', () => {
    bindings({ bindings: [{ context: 'Chat', bindings: { 'ctrl+r': 'toggle-verbose' } }] })
    const read = loadKeybindings(home)

    expect(read.bound).toEqual([{ ctrl: true, letter: 'r', action: 'toggle-verbose' }])
    expect(read.notApplied).toEqual([])
  })

  it('test_no_file_is_not_an_error_and_binds_nothing', () => {
    const read = loadKeybindings(home)
    expect(read.bound).toEqual([])
    expect(read.notApplied).toEqual([])
  })

  it('test_an_action_this_product_does_not_expose_is_named', () => {
    // The whole reason `REBINDABLE` is a declared list. Fourteen of this product's sixteen actions
    // are steps in a state-dependent ladder and have no meaning as a standalone key.
    bindings({ bindings: [{ context: 'Chat', bindings: { 'ctrl+r': 'openSettings' } }] })
    const read = loadKeybindings(home)

    expect(read.bound).toEqual([])
    expect(read.notApplied.join(' ')).toContain('openSettings')
  })

  it('test_a_keystroke_shape_this_product_cannot_match_is_named', () => {
    // Ink hands this router `{ ctrl, escape, return }` and the typed character. `shift+tab` and
    // chords are real in their format and are not matchable here; forwarding them would produce a
    // binding that silently never fires.
    bindings({
      bindings: [
        { context: 'Chat', bindings: { 'shift+tab': 'toggle-verbose', 'ctrl+k ctrl+s': 'quit' } },
      ],
    })
    const read = loadKeybindings(home)

    expect(read.bound).toEqual([])
    expect(read.notApplied.join(' ')).toContain('shift+tab')
    expect(read.notApplied.join(' ')).toContain('ctrl+k ctrl+s')
  })

  it('test_a_reserved_keystroke_is_refused_by_name', () => {
    // Their docs list seven that cannot be rebound. Ctrl-C is the one that matters here: it is how
    // an operator stops a runaway turn, and a config file must not be able to take it away.
    bindings({ bindings: [{ context: 'Global', bindings: { 'ctrl+c': 'toggle-verbose' } }] })
    const read = loadKeybindings(home)

    expect(read.bound).toEqual([])
    expect(read.notApplied.join(' ')).toContain('ctrl+c')
  })

  it('test_null_unbinds_nothing_here_and_says_so', () => {
    // `null` means "remove the built-in binding" in their format. This product's built-ins are
    // computed from state, not table entries, so there is nothing to remove — and pretending to
    // remove one would leave the key working exactly as before with a success reported.
    bindings({ bindings: [{ context: 'Chat', bindings: { 'ctrl+o': null } }] })
    const read = loadKeybindings(home)

    expect(read.bound).toEqual([])
    expect(read.notApplied.join(' ')).toContain('ctrl+o')
  })

  it('test_malformed_json_is_reported_rather_than_throwing_at_startup', () => {
    writeFileSync(join(home, '.claude', 'keybindings.json'), '{ not json')
    const read = loadKeybindings(home)

    expect(read.bound).toEqual([])
    expect(read.notApplied.join(' ')).toContain('could not be read')
  })

  it('test_the_rebindable_set_is_not_empty_so_these_arms_are_not_vacuous', () => {
    expect(REBINDABLE.length).toBeGreaterThan(0)
  })
})

describe('a key the router always claims', () => {
  it('test_it_is_refused_rather_than_counted_as_honoured', () => {
    // Found on the bench (#135) by the negative arm, not by this suite. `ctrl+o` is not in their
    // RESERVED list — it is not theirs — and it passes every other check: right shape, action in
    // REBINDABLE. So it was counted as bound while `boundAction` is consulted only where nothing
    // built-in claimed the key, and the built-in claims this one always. `/status` then said
    // `honoured` about a binding that can never fire, which is #132's family exactly: declared,
    // confirmed active by the product's own report, structurally incapable of running.
    bindings({ bindings: [{ context: 'Chat', bindings: { 'ctrl+o': 'quit' } }] })
    const read = loadKeybindings(home)

    expect(read.bound).toEqual([])
    expect(read.notApplied.join(' ')).toContain('ctrl+o')
  })

  it('test_a_key_the_router_does_not_claim_is_still_bound', () => {
    // Anti-vacuity floor: a loader that refused every ctrl+letter would satisfy the arm above.
    bindings({ bindings: [{ context: 'Chat', bindings: { 'ctrl+r': 'quit' } }] })
    expect(loadKeybindings(home).bound).toHaveLength(1)
  })

  it('test_the_two_sets_stay_separate', () => {
    // Their RESERVED list is copied verbatim on purpose. Folding a built-in of ours into it would
    // stop it being a faithful copy, and the provenance split is what this whole slice is built on.
    expect(RESERVED_FOR_REFERENCE.has('ctrl+o')).toBe(false)
    expect(CLAIMED_BY_ROUTER.has('ctrl+o')).toBe(true)
  })
})
