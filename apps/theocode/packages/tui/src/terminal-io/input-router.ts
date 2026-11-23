/**
 * What a keypress means, given what is on screen.
 *
 * B-104 slice 2 — the ORDERING is now `@theokit/tui/keys`; the LAYERS are this product's. Every
 * agent CLI rebuilds "which of my overlays claims this key", and every one of them writes it as an
 * if-chain whose order is the entire contract and is recorded nowhere. What the framework owns is
 * that layers are tried in declared order, the first whose `when` holds claims the key exclusively,
 * and the result names the claimant. What stays here is the vocabulary: `hasOpenQuestion`,
 * `backtrackArmed`, `prime-backtrack` — words a second agent CLI has no use for.
 *
 * Declaring the layers rather than nesting ifs makes the precedence readable in one place, which is
 * the property the old shape lacked: "Esc interrupts the turn" and "Esc opens the backtrack ladder"
 * were told apart eight lines into a helper, and a wrong answer there is silent — the key appears to
 * do nothing, or does the other thing.
 */
import { routeThroughLayers, type KeyLayer } from '@theokit/tui/keys'

import { stepBacktrack } from '../backtrack/backtrack-select.js'
import type { Keybinding } from './keybindings.js'

export interface KeyboardState {
  readonly hasOpenQuestion: boolean
  readonly trusted: boolean
  readonly hasPendingApproval: boolean
  readonly inDemoInput: boolean
  readonly inLogin: boolean
  readonly rotating: boolean
  readonly mode: string
  /**
   * #58 — VISIBLE, not toggled. `routeEscape` is the visual stacking order, so every `showing*`
   * here is a claim that the surface is on screen. `showingUsage` used to be fed `screen.showUsage`
   * raw, while the panel renders on `showUsage && lastUsage`: `/usage` before the first turn armed
   * a flag with nothing behind it, and this branch — which sits above `streaming` — then ate the
   * first Escape of the next stream. The conjunction is built in `use-tui-keyboard.ts`.
   */
  readonly showingUsage: boolean
  readonly showingDiff: boolean
  readonly showingHelp: boolean
  readonly goalActive: boolean
  readonly streaming: boolean
  readonly backtrackArmed: boolean
  readonly composerText: string
  readonly backtrackNth: number
  readonly backtrackTotal: number
  readonly exitArmed: boolean
}

export interface KeyPress {
  readonly ctrl: boolean
  readonly escape: boolean
  readonly return: boolean
}

export type KeyAction =
  | { readonly kind: 'abandon-question' }
  | { readonly kind: 'interrupt-turn' }
  | { readonly kind: 'close-progress' }
  | { readonly kind: 'close-usage' }
  | { readonly kind: 'close-diff' }
  | { readonly kind: 'close-help' }
  | { readonly kind: 'pause-goal' }
  | { readonly kind: 'prime-backtrack' }
  | { readonly kind: 'reset-backtrack' }
  | { readonly kind: 'advance-backtrack'; readonly next: number; readonly total: number }
  | { readonly kind: 'confirm-backtrack' }
  | { readonly kind: 'arm-exit' }
  | { readonly kind: 'quit' }
  | { readonly kind: 'disarm-exit' }
  | { readonly kind: 'close-demo' }
  | { readonly kind: 'toggle-verbose' }

/** The key that means "stop", spelled the way a terminal delivers it. */
const isCtrlC = (input: string, key: KeyPress): boolean => key.ctrl && input === 'c'

/**
 * The transcript toggle, spelled the way Claude Code spells it.
 *
 * ctrl+o and not a slash command: this is a READING gesture, reached mid-answer while the eye is on
 * the output, and a command would cost a round trip through the composer to change nothing but what
 * is on screen. `@theokit/tui` names the same key in its own docblock for `verbose`, so both halves
 * of the contract agree on the binding.
 */
const isCtrlO = (input: string, key: KeyPress): boolean => key.ctrl && input === 'o'

/**
 * The layers, in precedence order. The order IS the contract — reading it top to bottom answers
 * "what does Esc do right now?" without following a call chain.
 */
/**
 * What a layer is handed. `bindings` travels HERE rather than as a third `route` argument because
 * the framework's `route` takes `(key, state)` — widening the key object is the seam that exists,
 * and it keeps `LAYERS` hoisted instead of rebuilt per keystroke.
 */
interface RoutedInput {
  readonly input: string
  readonly key: KeyPress
  readonly bindings: readonly Keybinding[]
}

const LAYERS: readonly KeyLayer<KeyboardState, RoutedInput, KeyAction>[] = [
  {
    // An open question owns the screen: Ctrl-C abandons it AND stops the turn behind it, and
    // nothing else reaches the composer while it is up.
    name: 'open-question',
    when: (s) => s.hasOpenQuestion,
    route: ({ input, key }) =>
      isCtrlC(input, key) ? [{ kind: 'abandon-question' }, { kind: 'interrupt-turn' }] : [],
  },
  {
    name: 'demo',
    when: (s) => s.inDemoInput,
    route: ({ input, key }, s) => {
      if (key.escape) return [{ kind: 'close-demo' }]
      if (!isCtrlC(input, key)) return []
      return s.exitArmed ? [{ kind: 'quit' }] : [{ kind: 'arm-exit' }]
    },
  },
  {
    // The swallow layer, and the reason `routeThroughLayers` distinguishes "claimed with no action"
    // from "unclaimed": an approval gate, a login flow or a key rotation must ABSORB the key rather
    // than let the composer act on it. An untrusted directory is in the same set — nothing it can
    // reach should respond until the operator has said yes.
    name: 'gated',
    when: (s) => !s.trusted || s.hasPendingApproval || s.inLogin || s.rotating,
    route: () => [],
  },
  {
    // The composer context: whatever is NOT claimed above lands here, and inside it the KEY decides.
    //
    // Escape and the composer are one modal layer, not two. A layer is a state — "the composer is
    // focused" — and `when` deliberately sees only the state, so a layer cannot be selected by which
    // key arrived. Splitting them would mean an escape layer that claims EVERY key and silently
    // swallows the ones that are not Escape, which is the exact failure the swallow/unclaimed
    // distinction exists to make visible.
    name: 'composer',
    when: () => true,
    route: ({ input, key, bindings }, s) =>
      key.escape
        ? routeEscape(s)
        : routeInComposer(input, key, s, isCtrlC(input, key), isCtrlO(input, key), bindings),
  },
]

/**
 * A configured binding (`~/.claude/keybindings.json`), consulted only where nothing built-in claimed
 * the key.
 *
 * Inside the composer layer rather than as a layer of its own, and that placement IS the collision
 * rule. A layer before `composer` would let a file displace `ctrl+o`; a layer after it can never
 * run, because `composer` claims every key. Consulting bindings last means a built-in gesture always
 * wins a collision and a binding fills in what was unclaimed — a file cannot take a key away, only
 * give one a meaning it did not have.
 *
 * It is inside `composer` for a second reason: `gated` sits above, so a binding cannot reach past
 * the layer that withholds keys from an untrusted directory or a pending approval.
 */
function boundAction(
  input: string,
  key: KeyPress,
  bindings: readonly Keybinding[],
): KeyAction | null {
  if (!key.ctrl) return null
  const hit = bindings.find((b) => b.letter === input)
  if (hit === undefined) return null
  // The three rebindable gestures, spelled once. A `kind` that took a payload could not live in this
  // set — which is why `keybindings.ts` declares the set rather than deriving it from `KeyAction`.
  if (hit.action === 'toggle-verbose') return { kind: 'toggle-verbose' }
  if (hit.action === 'interrupt-turn') return { kind: 'interrupt-turn' }
  return { kind: 'quit' }
}

function routeInComposer(
  input: string,
  key: KeyPress,
  state: KeyboardState,
  ctrlC: boolean,
  ctrlO: boolean,
  bindings: readonly Keybinding[],
): KeyAction[] {
  const actions: KeyAction[] = []

  if (state.backtrackArmed) {
    if (key.return) return [{ kind: 'confirm-backtrack' }]
    actions.push({ kind: 'reset-backtrack' })
  }

  if (ctrlO) {
    actions.push({ kind: 'toggle-verbose' })
    return actions
  }

  if (ctrlC) {
    if (state.streaming) actions.push({ kind: 'interrupt-turn' })
    else actions.push(state.exitArmed ? { kind: 'quit' } : { kind: 'arm-exit' })
    return actions
  }

  // Last, so a built-in gesture wins a collision and a configured key only fills in silence.
  const bound = boundAction(input, key, bindings)
  if (bound !== null) {
    actions.push(bound)
    return actions
  }

  if (state.exitArmed) actions.push({ kind: 'disarm-exit' })
  return actions
}

/**
 * Escape is its own dismiss ladder: whatever is topmost closes first, and only when nothing is open
 * does it reach the backtrack gesture. The order here is the visual stacking order, which is why it
 * is written as a list rather than derived.
 *
 * That framing is load-bearing and it is a PRECONDITION on the caller: each flag below must mean
 * the surface is on screen. This function cannot check it — a flag whose two possible meanings are
 * indistinguishable from here is exactly how #58 shipped.
 */
function routeEscape(state: KeyboardState): KeyAction[] {
  if (state.mode === 'progress') return [{ kind: 'close-progress' }]
  if (state.showingDiff) return [{ kind: 'close-diff' }]
  if (state.showingUsage) return [{ kind: 'close-usage' }]
  if (state.showingHelp) return [{ kind: 'close-help' }]
  if (state.goalActive) return [{ kind: 'pause-goal' }]
  if (state.streaming) return [{ kind: 'interrupt-turn' }]

  if (!state.backtrackArmed) {
    // A composer with text in it means Esc was meant for the text, not for the ladder.
    if (state.composerText.trim().length > 0) return []
    return [{ kind: 'prime-backtrack' }]
  }

  const next = stepBacktrack(state.backtrackNth, state.backtrackTotal)
  if (next === null) return [{ kind: 'reset-backtrack' }]
  return [{ kind: 'advance-backtrack', next, total: state.backtrackTotal }]
}

export function routeKey(
  input: string,
  key: KeyPress,
  state: KeyboardState,
  bindings: readonly Keybinding[] = [],
): KeyAction[] {
  return [...routeThroughLayers(LAYERS, { input, key, bindings }, state).actions]
}
