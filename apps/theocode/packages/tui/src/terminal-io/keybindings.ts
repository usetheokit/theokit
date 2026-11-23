/**
 * `~/.claude/keybindings.json` — Claude Code's file, read for the gestures this product actually has.
 *
 * Format measured against `code.claude.com/docs/en/keybindings.md` on 2026-09-07:
 * `{ bindings: [{ context, bindings: { "<keystroke>": "<action>" | null } }] }`, modifiers joined by
 * `+`, chords separated by spaces, and seven reserved keystrokes that cannot be rebound.
 *
 * ## Why this is small, stated rather than hidden
 *
 * This product has NO key→action table to rebind. `input-router.ts` computes the action from the
 * screen state: Escape is a dismiss ladder whose meaning is the visual stacking order, and Ctrl-C
 * means abandon, interrupt, arm-exit or quit depending on five state fields. Three keys in total.
 *
 * So what a file can rebind here is the set of gestures that mean ONE thing regardless of what is on
 * screen. That set is DECLARED below rather than inferred from the action union, because fourteen of
 * this product's sixteen actions are steps in a ladder and have no meaning as a standalone key. A
 * loader that accepted them would be promising a table that does not exist.
 *
 * Everything the file asks for and does not get is reported by name: an action outside the set, a
 * keystroke shape this router cannot match, a reserved key, an unbind. The report is what keeps the
 * smallness visible — a loader that read a 40-line keybindings file and silently honoured one line
 * would teach the operator that the other 39 are in force.
 *
 * `context` is read and not acted on: this product's layers are its own, and mapping their twenty
 * context names onto four would be a translation nobody measured. A binding applies wherever its
 * gesture applies, which for the declared set is everywhere the composer has the key.
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * The actions a key can be bound to.
 *
 * Deliberately a list, not the `KeyAction` union: the union includes ladder steps
 * (`advance-backtrack`, `close-usage`, `disarm-exit`) whose meaning comes from what is on screen.
 * Adding a gesture here is one line, and it is a decision — which is the point of writing it out.
 */
export const REBINDABLE = ['toggle-verbose', 'interrupt-turn', 'quit'] as const

type RebindableAction = (typeof REBINDABLE)[number]

/**
 * Their reserved list, verbatim. `ctrl+c` is the one that matters most here: it is how an operator
 * stops a runaway turn, and no configuration file may take it away.
 */
export const RESERVED_FOR_REFERENCE = new Set([
  'ctrl+c',
  'ctrl+d',
  'ctrl+m',
  'ctrl+[',
  'ctrl+i',
  'ctrl+h',
])

/**
 * Keys THIS router always claims, so a binding on one could never fire.
 *
 * A second set rather than an addition to theirs, and the separation is the point. Their list is
 * copied verbatim; folding one of our built-ins into it would stop it being a faithful copy, and
 * provenance-as-the-rule is what this whole slice is built on.
 *
 * Found on the bench (#135): `ctrl+o` is not reserved by them, has the right shape, and names an
 * action in `REBINDABLE` — so it passed every check and was counted as bound, while `boundAction` is
 * consulted only where nothing built-in claimed the key and the built-in claims this one always.
 * `/status` then reported `honoured` for a binding that can never run — #132's family exactly.
 *
 * `ctrl+c` is in both sets, and that is correct: it is reserved by them AND claimed here, and the
 * reserved message is the more useful of the two.
 */
export const CLAIMED_BY_ROUTER = new Set(['ctrl+o', 'ctrl+c'])

export interface Keybinding {
  readonly ctrl: true
  readonly letter: string
  readonly action: RebindableAction
}

export interface KeybindingsRead {
  readonly bound: readonly Keybinding[]
  /** Every binding the file asked for and did not get, with the reason. */
  readonly notApplied: readonly string[]
}

/**
 * What this router can match: `ctrl+<single letter>`.
 *
 * Ink hands it `{ ctrl, escape, return }` plus the typed character, so `shift+tab`, the arrow keys
 * and chords are not matchable here. Accepting them would produce a binding that never fires, with
 * nothing said — strictly worse than refusing it by name.
 */
const CTRL_LETTER = /^ctrl\+([a-z])$/

function isRebindable(action: unknown): action is RebindableAction {
  return typeof action === 'string' && (REBINDABLE as readonly string[]).includes(action)
}

function readOne(
  keystroke: string,
  action: unknown,
  bound: Keybinding[],
  notApplied: string[],
): void {
  const key = keystroke.trim().toLowerCase()
  if (RESERVED_FOR_REFERENCE.has(key)) {
    notApplied.push(`"${keystroke}" is reserved and cannot be rebound`)
    return
  }
  if (CLAIMED_BY_ROUTER.has(key)) {
    notApplied.push(
      `"${keystroke}" is a built-in gesture here and always claims the key — a binding on it ` +
        'could never fire',
    )
    return
  }
  if (action === null) {
    notApplied.push(
      `"${keystroke}": this product's built-in keys are computed from screen state, not table ` +
        'entries, so there is no binding to remove',
    )
    return
  }
  if (!isRebindable(action)) {
    notApplied.push(
      `"${keystroke}" -> "${String(action)}": not a gesture this product exposes ` +
        `(${REBINDABLE.join(', ')})`,
    )
    return
  }
  const match = CTRL_LETTER.exec(key)
  if (match?.[1] === undefined) {
    notApplied.push(`"${keystroke}": this product matches ctrl+<letter> only`)
    return
  }
  bound.push({ ctrl: true, letter: match[1], action })
}

export function loadKeybindings(home: string = homedir()): KeybindingsRead {
  const path = join(home, '.claude', 'keybindings.json')
  if (!existsSync(path)) return { bound: [], notApplied: [] }

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    // Never thrown at startup: a typo in an optional file must not take the product away, and a
    // silent skip would leave the operator with a file they believe is in force.
    return { bound: [], notApplied: [`${path} could not be read: ${(err as Error).message}`] }
  }

  const groups = (parsed as { bindings?: unknown }).bindings
  if (!Array.isArray(groups)) return { bound: [], notApplied: [`${path}: no "bindings" array`] }

  const bound: Keybinding[] = []
  const notApplied: string[] = []
  for (const group of groups) {
    const map = (group as { bindings?: unknown }).bindings
    if (typeof map !== 'object' || map === null) continue
    for (const [keystroke, action] of Object.entries(map as Record<string, unknown>)) {
      readOne(keystroke, action, bound, notApplied)
    }
  }
  return { bound, notApplied }
}
