/**
 * #58 — the Escape ladder must be told what is ON SCREEN, not which toggle was flipped.
 *
 * `routeEscape` is written as the visual stacking order and its docblock says "whatever is topmost
 * closes first", so every flag it reads has to mean the corresponding surface is VISIBLE. The
 * usage panel renders only when BOTH halves hold — `ConversationRegion.tsx`,
 * `{props.showUsage && props.lastUsage ? <UsagePanel/> : null}` — while the ladder was handed
 * `screen.showUsage` alone, from this file.
 *
 * `/usage` before the first turn therefore armed an invisible flag, and because the usage branch
 * sits ABOVE `streaming`, the next Escape during a stream was consumed closing a panel that was
 * never on screen: the first Escape did nothing observable and the second interrupted — on the
 * gesture whose whole purpose is stopping a runaway turn promptly.
 *
 * The router cannot repair this itself: it is handed a flag whose two meanings it has no way to
 * distinguish. So the fix, and this test, live at the translation.
 */
import { describe, expect, it } from 'vitest'

import type { ScreenState } from '../../src/rendering/index.js'
import { SENTINEL } from '../../src/backtrack/backtrack-select.js'
import { routeKey, type KeyPress } from '../../src/terminal-io/input-router.js'
import { keyboardState, type KeyboardDeps } from '../../src/terminal-io/use-tui-keyboard.js'

const ESC: KeyPress = { ctrl: false, escape: true, return: false }

function deps(over: {
  showUsage: boolean
  hasLastUsage: boolean
  streaming?: boolean
}): KeyboardDeps {
  const screen = {
    mode: 'chat',
    showUsage: over.showUsage,
    showHelp: false,
    panel: undefined,
    composerText: '',
    exitArmed: false,
    loginProvider: undefined,
  } as unknown as ScreenState
  return {
    screen,
    agent: { abort: () => undefined },
    backtrack: {
      rotating: false,
      armed: false,
      nth: SENTINEL,
      total: 0,
      prime: () => undefined,
      reset: () => undefined,
      advance: () => undefined,
      confirm: () => undefined,
    },
    goalAbort: { current: null },
    pendingQuestion: undefined,
    pendingApproval: undefined,
    trusted: true,
    streaming: over.streaming ?? false,
    goalActive: false,
    hasLastUsage: over.hasLastUsage,
    currentSessionId: () => 'tui-1',
    setPendingQuestion: () => undefined,
    interruptTurn: () => undefined,
    exit: () => undefined,
  }
}

describe('#58 — showingUsage means the panel is on screen', () => {
  it('test_the_flag_alone_does_not_claim_a_visible_panel', () => {
    // `/usage` before any turn: the toggle is on, there is no usage to draw, nothing is rendered.
    expect(keyboardState(deps({ showUsage: true, hasLastUsage: false })).showingUsage).toBe(false)
  })

  it('test_the_panel_is_claimed_when_both_halves_hold', () => {
    // Anti-vacuity floor: reporting `false` unconditionally would satisfy the assertion above.
    expect(keyboardState(deps({ showUsage: true, hasLastUsage: true })).showingUsage).toBe(true)
  })

  it('test_escape_interrupts_the_stream_when_the_usage_toggle_armed_nothing', () => {
    const state = keyboardState(deps({ showUsage: true, hasLastUsage: false, streaming: true }))

    expect(
      routeKey('', ESC, state).map((a) => a.kind),
      'the first Escape of a stream was eaten closing a panel that was never on screen',
    ).toEqual(['interrupt-turn'])
  })

  it('test_escape_still_closes_a_usage_panel_that_is_on_screen', () => {
    const state = keyboardState(deps({ showUsage: true, hasLastUsage: true, streaming: true }))

    expect(routeKey('', ESC, state).map((a) => a.kind)).toEqual(['close-usage'])
  })
})
