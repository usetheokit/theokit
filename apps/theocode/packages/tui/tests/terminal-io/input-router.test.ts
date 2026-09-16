/**
 * B-116 — `routeKey` is where the surface decides what a key MEANS, and it had no direct test.
 *
 * It is a 115-LoC modal state machine spanning seven surface states, and its failures are the
 * silent kind: the key appears to do nothing, or it does the other thing. B-029 is the record of
 * exactly that — Esc-rewind was dead in a shipped build because a flag was raised before the data
 * it announced, and nothing saw it.
 *
 * Two properties make this cheap to pin, and both are deliberate in the design: `routeKey` is
 * PURE, and it returns the actions rather than performing them. So every case below asserts the
 * returned array — no terminal, no Ink, no React. Asserting the effect of applying the actions
 * would test `applyKeyAction` instead, and would pass on a router that returned the wrong action
 * whenever two actions happened to converge on the same effect.
 *
 * Precedence gets its own block. Most of the real defects here are not "the wrong branch is
 * broken" but "the right branch never runs", because an earlier guard swallowed the key.
 */
import { describe, expect, it } from 'vitest'

import { SENTINEL } from '../../src/backtrack/backtrack-select.js'
import { type KeyboardState, type KeyPress, routeKey } from '../../src/terminal-io/input-router.js'

/** Trusted, idle, nothing open — the state every case below varies ONE field of. */
const IDLE: KeyboardState = {
  hasOpenQuestion: false,
  trusted: true,
  hasPendingApproval: false,
  inDemoInput: false,
  inLogin: false,
  rotating: false,
  mode: 'composer',
  showingUsage: false,
  showingDiff: false,
  showingHelp: false,
  goalActive: false,
  streaming: false,
  backtrackArmed: false,
  composerText: '',
  backtrackNth: SENTINEL,
  backtrackTotal: 0,
  exitArmed: false,
}

const CTRL_C: KeyPress = { ctrl: true, escape: false, return: false }
const ESC: KeyPress = { ctrl: false, escape: true, return: false }
const ENTER: KeyPress = { ctrl: false, escape: false, return: true }
const PLAIN: KeyPress = { ctrl: false, escape: false, return: false }

const kinds = (actions: ReturnType<typeof routeKey>): string[] => actions.map((a) => a.kind)

describe('routeKey — an open question owns the keyboard', () => {
  it('test_ctrl_c_abandons_the_question_and_interrupts_the_turn', () => {
    // Both, in this order: abandoning without interrupting leaves the turn generating an answer to
    // a question nobody is going to answer.
    const state = { ...IDLE, hasOpenQuestion: true }
    expect(kinds(routeKey('c', CTRL_C, state))).toEqual(['abandon-question', 'interrupt-turn'])
  })

  it('test_every_other_key_is_swallowed_while_a_question_is_open', () => {
    const state = { ...IDLE, hasOpenQuestion: true, exitArmed: true }
    expect(routeKey('', ESC, state)).toEqual([])
    expect(routeKey('x', PLAIN, state)).toEqual([])
    // `exitArmed` is set above on purpose: the composer would emit `disarm-exit` for a plain key,
    // and it must not reach here.
    expect(routeKey('', ENTER, state)).toEqual([])
  })
})

describe('routeKey — demo input', () => {
  const demo = { ...IDLE, inDemoInput: true }

  it('test_escape_closes_the_demo', () => {
    expect(kinds(routeKey('', ESC, demo))).toEqual(['close-demo'])
  })

  it('test_ctrl_c_arms_the_exit_and_then_quits', () => {
    // Two presses, not one. A single Ctrl-C quitting out of a demo would lose whatever the user
    // was mid-way through typing.
    expect(kinds(routeKey('c', CTRL_C, demo))).toEqual(['arm-exit'])
    expect(kinds(routeKey('c', CTRL_C, { ...demo, exitArmed: true }))).toEqual(['quit'])
  })

  it('test_ordinary_keys_belong_to_the_demo_not_the_router', () => {
    expect(routeKey('x', PLAIN, demo)).toEqual([])
    expect(routeKey('', ENTER, demo)).toEqual([])
  })
})

describe('routeKey — the gates that swallow every key', () => {
  // Four independent reasons the surface is not accepting input. Each is asserted separately
  // because collapsing them into one case would let three of them break unnoticed.
  const gates: ReadonlyArray<[string, Partial<KeyboardState>]> = [
    ['an untrusted directory', { trusted: false }],
    ['a pending approval', { hasPendingApproval: true }],
    ['the login flow', { inLogin: true }],
    ['a key rotation', { rotating: true }],
  ]

  for (const [label, patch] of gates) {
    it(`test_${label.replace(/\s+/g, '_')}_swallows_every_key`, () => {
      const state = { ...IDLE, ...patch, streaming: true, exitArmed: true }
      expect(routeKey('c', CTRL_C, state)).toEqual([])
      expect(routeKey('', ESC, state)).toEqual([])
      expect(routeKey('x', PLAIN, state)).toEqual([])
    })
  }

  it('test_an_open_question_outranks_every_gate', () => {
    // Ctrl-C must still abandon a question in an untrusted directory — otherwise the surface is
    // stuck with a question it will not let you dismiss.
    const state = { ...IDLE, hasOpenQuestion: true, trusted: false }
    expect(kinds(routeKey('c', CTRL_C, state))).toEqual(['abandon-question', 'interrupt-turn'])
  })
})

describe('routeKey — escape, in priority order', () => {
  // The order below IS the contract. Each case sets its own trigger plus every LOWER-priority
  // trigger, so a reordering of the branches turns it red instead of quietly changing which
  // overlay Esc closes.
  it('test_escape_closes_progress_before_anything_else', () => {
    const state = {
      ...IDLE,
      mode: 'progress',
      showingDiff: true,
      showingUsage: true,
      showingHelp: true,
      goalActive: true,
      streaming: true,
    }
    expect(kinds(routeKey('', ESC, state))).toEqual(['close-progress'])
  })

  it('test_escape_closes_the_diff_before_usage_help_goal_or_the_turn', () => {
    const state = {
      ...IDLE,
      showingDiff: true,
      showingUsage: true,
      showingHelp: true,
      goalActive: true,
      streaming: true,
    }
    expect(kinds(routeKey('', ESC, state))).toEqual(['close-diff'])
  })

  it('test_escape_closes_usage_before_help_goal_or_the_turn', () => {
    const state = {
      ...IDLE,
      showingUsage: true,
      showingHelp: true,
      goalActive: true,
      streaming: true,
    }
    expect(kinds(routeKey('', ESC, state))).toEqual(['close-usage'])
  })

  it('test_escape_closes_help_before_the_goal_or_the_turn', () => {
    const state = { ...IDLE, showingHelp: true, goalActive: true, streaming: true }
    expect(kinds(routeKey('', ESC, state))).toEqual(['close-help'])
  })

  it('test_escape_pauses_the_goal_before_interrupting_the_turn', () => {
    // A goal owns the turns it runs, so pausing it is the meaningful stop; interrupting one turn
    // would just let the goal start the next.
    const state = { ...IDLE, goalActive: true, streaming: true }
    expect(kinds(routeKey('', ESC, state))).toEqual(['pause-goal'])
  })

  it('test_escape_interrupts_a_streaming_turn', () => {
    expect(kinds(routeKey('', ESC, { ...IDLE, streaming: true }))).toEqual(['interrupt-turn'])
  })
})

describe('routeKey — escape and the backtrack ladder', () => {
  it('test_escape_primes_the_ladder_only_when_the_composer_is_empty', () => {
    // With text in the composer Esc must do NOTHING: opening a rewind ladder over a half-typed
    // message is how you lose it.
    expect(kinds(routeKey('', ESC, IDLE))).toEqual(['prime-backtrack'])
    expect(routeKey('', ESC, { ...IDLE, composerText: 'half a thought' })).toEqual([])
    // Whitespace is not text — the guard trims, and a stray space must not block the ladder.
    expect(kinds(routeKey('', ESC, { ...IDLE, composerText: '   ' }))).toEqual(['prime-backtrack'])
  })

  it('test_escape_advances_the_armed_ladder_one_turn_at_a_time', () => {
    const armed = { ...IDLE, backtrackArmed: true, backtrackNth: SENTINEL, backtrackTotal: 3 }
    // From the sentinel, the first step lands on the newest user turn (total - 1), not on total.
    expect(routeKey('', ESC, armed)).toEqual([{ kind: 'advance-backtrack', next: 2, total: 3 }])
    expect(routeKey('', ESC, { ...armed, backtrackNth: 2 })).toEqual([
      { kind: 'advance-backtrack', next: 1, total: 3 },
    ])
    // It floors at 0 rather than walking negative.
    expect(routeKey('', ESC, { ...armed, backtrackNth: 0 })).toEqual([
      { kind: 'advance-backtrack', next: 0, total: 3 },
    ])
  })

  it('test_an_armed_ladder_with_no_turns_to_rewind_resets_instead', () => {
    // The B-029 shape: armed with a total of 0. It must reset, not offer a ladder over nothing.
    const armed = { ...IDLE, backtrackArmed: true, backtrackNth: SENTINEL, backtrackTotal: 0 }
    expect(kinds(routeKey('', ESC, armed))).toEqual(['reset-backtrack'])
  })
})

describe('routeKey — the composer', () => {
  it('test_enter_confirms_an_armed_backtrack_and_nothing_else', () => {
    const armed = { ...IDLE, backtrackArmed: true, exitArmed: true }
    // Alone: confirming must not also disarm the exit, or a later Ctrl-C behaves unexpectedly.
    expect(kinds(routeKey('', ENTER, armed))).toEqual(['confirm-backtrack'])
  })

  it('test_any_other_key_resets_an_armed_backtrack', () => {
    // Typing is how you leave the ladder. Resetting must happen even though the key also does its
    // ordinary job, which is why the action list is asserted whole.
    expect(kinds(routeKey('x', PLAIN, { ...IDLE, backtrackArmed: true }))).toEqual([
      'reset-backtrack',
    ])
    expect(kinds(routeKey('x', PLAIN, { ...IDLE, backtrackArmed: true, exitArmed: true }))).toEqual(
      ['reset-backtrack', 'disarm-exit'],
    )
  })

  it('test_ctrl_c_interrupts_a_streaming_turn_rather_than_arming_the_exit', () => {
    // The distinction that matters: Ctrl-C during a turn stops the turn. Arming the exit there
    // would make the first Ctrl-C look like it did nothing.
    expect(kinds(routeKey('c', CTRL_C, { ...IDLE, streaming: true }))).toEqual(['interrupt-turn'])
    // …and it does not quit either, even with the exit already armed.
    expect(kinds(routeKey('c', CTRL_C, { ...IDLE, streaming: true, exitArmed: true }))).toEqual([
      'interrupt-turn',
    ])
  })

  it('test_ctrl_c_arms_the_exit_when_idle_and_quits_on_the_second', () => {
    expect(kinds(routeKey('c', CTRL_C, IDLE))).toEqual(['arm-exit'])
    expect(kinds(routeKey('c', CTRL_C, { ...IDLE, exitArmed: true }))).toEqual(['quit'])
  })

  it('test_ctrl_c_resets_an_armed_backtrack_before_acting_on_the_exit', () => {
    const state = { ...IDLE, backtrackArmed: true, backtrackTotal: 3 }
    expect(kinds(routeKey('c', CTRL_C, state))).toEqual(['reset-backtrack', 'arm-exit'])
  })

  it('test_an_ordinary_key_disarms_a_primed_exit', () => {
    // Typing means you did not mean to quit. Without this, a Ctrl-C from ten minutes ago is still
    // live and the next one quits.
    expect(kinds(routeKey('x', PLAIN, { ...IDLE, exitArmed: true }))).toEqual(['disarm-exit'])
    expect(routeKey('x', PLAIN, IDLE)).toEqual([])
  })

  it('test_ctrl_with_another_letter_is_not_ctrl_c', () => {
    // `ehCtrlC` tests the letter too. A router keyed on `key.ctrl` alone would quit on Ctrl-A.
    const ctrlA: KeyPress = { ctrl: true, escape: false, return: false }
    expect(routeKey('a', ctrlA, IDLE)).toEqual([])
  })
})

/**
 * ctrl+o — the transcript toggle (usetheokit/theokit-tui#61).
 *
 * The precedence cases are the ones worth pinning: a reading gesture must not fire while the
 * keyboard belongs to something else, and it must not shadow ctrl+c, which is how a person stops a
 * runaway turn. Both are properties of WHERE the branch sits, which is exactly the class of defect
 * this file's header calls "the right branch never runs".
 */
describe('routeKey — ctrl+o toggles the transcript', () => {
  it('test_ctrl_o_in_the_composer_toggles_verbose', () => {
    expect(kinds(routeKey('o', CTRL_C, IDLE))).toEqual(['toggle-verbose'])
  })

  it('test_ctrl_c_still_wins_its_own_key', () => {
    // Anti-shadow: the two share `key.ctrl`, and a branch ordered by `key.ctrl` alone would have
    // swallowed the interrupt — the one key a person needs when a turn will not stop.
    expect(kinds(routeKey('c', CTRL_C, IDLE))).toEqual(['arm-exit'])
    expect(kinds(routeKey('c', CTRL_C, { ...IDLE, streaming: true }))).toEqual([
      'interrupt-turn',
    ])
  })

  it('test_a_bare_o_is_not_the_toggle', () => {
    // Anti-vacuity: typing "o" into the composer must reach the composer.
    expect(kinds(routeKey('o', PLAIN, IDLE))).toEqual([])
  })

  it('test_the_toggle_does_not_fire_while_another_surface_owns_the_keyboard', () => {
    for (const state of [
      { ...IDLE, hasOpenQuestion: true },
      { ...IDLE, hasPendingApproval: true },
      { ...IDLE, inDemoInput: true, mode: 'plan' as const },
    ]) {
      expect(
        kinds(routeKey('o', CTRL_C, state)),
        'a reading gesture stole a key from a surface that was waiting for an answer',
      ).not.toContain('toggle-verbose')
    }
  })
})

describe('a configured keybinding', () => {
  const S = { ...IDLE, trusted: true }

  it('test_a_bound_key_produces_its_action', () => {
    expect(routeKey('r', { ctrl: true, escape: false, return: false }, S, [
      { ctrl: true, letter: 'r', action: 'toggle-verbose' },
    ])).toEqual([{ kind: 'toggle-verbose' }])
  })

  it('test_the_same_key_without_the_binding_does_nothing', () => {
    // Anti-vacuity floor, and the only arm that distinguishes "the binding worked" from "ctrl+r
    // already did that". Without it the assertion above passes against a router that ignores the
    // configuration entirely.
    expect(routeKey('r', { ctrl: true, escape: false, return: false }, S, [])).toEqual([])
  })

  it('test_a_binding_does_not_reach_past_the_gate', () => {
    // The `gated` layer swallows keys while an approval, a login or an untrusted directory is in
    // force. A configured binding must not be a way around it — that layer is the one that stops a
    // repository the operator has not trusted from getting a keystroke.
    expect(
      routeKey('r', { ctrl: true, escape: false, return: false }, { ...IDLE, trusted: false }, [
        { ctrl: true, letter: 'r', action: 'toggle-verbose' },
      ]),
    ).toEqual([])
  })

  it('test_a_binding_does_not_displace_the_built_in_meaning_of_the_same_key', () => {
    // ctrl+o already toggles verbose. Binding it to `quit` must not turn a reading gesture into an
    // exit: the built-in layers are tried first, so a collision loses rather than shadowing.
    expect(
      routeKey('o', { ctrl: true, escape: false, return: false }, S, [
        { ctrl: true, letter: 'o', action: 'quit' },
      ]),
    ).toEqual([{ kind: 'toggle-verbose' }])
  })
})
