import { useInput } from 'ink'

import { abandonQuestion } from '@theocode/agent/ask'
import type { ScreenState } from '../rendering/index.js'
import { routeKey, type KeyboardState } from './input-router.js'
import { loadKeybindings, type Keybinding } from './keybindings.js'
import { applyKeyActions } from './apply-key-action.js'

export interface KeyboardDeps {
  readonly screen: ScreenState
  readonly agent: { abort: () => void }
  readonly backtrack: {
    rotating: boolean
    armed: boolean
    nth: number
    total: number
    prime: () => void
    reset: () => void
    advance: (next: number, total: number) => void
    confirm: () => void
  }
  readonly goalAbort: { current: AbortController | null }
  readonly pendingQuestion: string | undefined
  readonly pendingApproval: unknown
  readonly trusted: boolean
  readonly streaming: boolean
  readonly goalActive: boolean
  /**
   * #58 — whether the last turn left usage to draw. NOT a preference: it is the other half of the
   * condition `ConversationRegion.tsx` renders the panel on (`showUsage && lastUsage`), and the
   * Escape ladder needs the conjunction rather than the toggle. See `showingUsage` below.
   */
  readonly hasLastUsage: boolean
  readonly currentSessionId: () => string
  readonly setPendingQuestion: (q: string | undefined) => void
  readonly interruptTurn: () => void
  readonly exit: () => void
}

export function keyboardState(deps: KeyboardDeps): KeyboardState {
  const {
    screen,
    backtrack,
    pendingQuestion,
    pendingApproval,
    trusted,
    streaming,
    goalActive,
    hasLastUsage,
  } = deps
  const inDemoInput = screen.mode === 'plan' || screen.mode === 'ask' || screen.mode === 'select'
  return {
    hasOpenQuestion: pendingQuestion !== undefined,
    trusted: trusted,
    hasPendingApproval: Boolean(pendingApproval),
    inDemoInput: inDemoInput,
    inLogin: screen.loginProvider !== undefined,
    rotating: backtrack.rotating,
    mode: screen.mode,
    // #58 — the CONJUNCTION, because `routeEscape` reads this as "a usage panel is on screen" and
    // sits above `streaming`. Fed the raw toggle, `/usage` before the first turn rendered nothing,
    // said nothing, and then ate the first Escape of the next stream — on the gesture whose whole
    // purpose is stopping a runaway turn promptly.
    showingUsage: screen.showUsage && hasLastUsage,
    showingDiff: screen.panel !== undefined,
    showingHelp: screen.showHelp,
    goalActive: goalActive,
    streaming: streaming,
    backtrackArmed: backtrack.armed,
    composerText: screen.composerText,
    backtrackNth: backtrack.nth,
    backtrackTotal: backtrack.total,
    exitArmed: screen.exitArmed,
  }
}

/**
 * Read ONCE, at module load, not per keystroke.
 *
 * Their docs say Claude Code watches `~/.claude/themes/` and reloads; nothing says that about
 * keybindings, and reading a file on every keypress would be a syscall per character typed. What is
 * lost is picking up an edit without a restart, which is stated in the README rather than implied.
 *
 * `notApplied` is deliberately not surfaced here: this hook has no place to put a message, and
 * stderr under the TUI is a log file nobody has open. `/status` reports it, beside the theme.
 *
 * NOT `theocode doctor`, which is where the settings keys and the output style are reported. The CLI
 * does not depend on the TUI and must not start: `theme-base.ts` records the same boundary for the
 * same reason — a rendering preference does not belong in the agent's contract. The operator who has
 * a keybindings file is the one running the TUI, and `/status` is where that operator already reads
 * the theme decision.
 */
const CONFIGURED = loadKeybindings()
const CONFIGURED_BINDINGS: readonly Keybinding[] = CONFIGURED.bound

/** What the keybindings file asked for and did not get — read by `/status`. */
export function keybindingsNotApplied(): readonly string[] {
  return CONFIGURED.notApplied
}

export function useTuiKeyboard(deps: KeyboardDeps): void {
  const {
    screen,
    agent,
    backtrack,
    goalAbort,
    currentSessionId,
    setPendingQuestion,
    interruptTurn,
    exit,
  } = deps

  useInput((input, key) => {
    const actions = routeKey(input, key, keyboardState(deps), CONFIGURED_BINDINGS)

    applyKeyActions(actions, {
      abandonQuestion: () => {
        abandonQuestion(currentSessionId())
        setPendingQuestion(undefined)
      },
      interruptTurn: interruptTurn,
      goToChat: () => screen.setMode('chat'),
      cancelDemo: () => {
        screen.setMode('chat')
        screen.setToast({ message: 'Demo cancelled', variant: 'info' })
      },
      closeDiff: () => screen.setPanel(undefined),
      closeUsage: () => screen.setShowUsage(false),
      closeHelp: () => screen.setShowHelp(false),
      pauseGoal: () => {
        goalAbort.current?.abort()
        agent.abort()
        screen.setToast({ message: 'Goal pausing… (/goal resume continues)', variant: 'info' })
      },
      primeBacktrack: backtrack.prime,
      resetBacktrack: backtrack.reset,
      advanceBacktrack: backtrack.advance,
      confirmBacktrack: backtrack.confirm,
      armExit: () => screen.setExitArmed(true),
      disarmExit: () => screen.setExitArmed(false),
      toggleVerbose: () => screen.setVerbose((v) => !v),
      quit: exit,
    })
  })
}
