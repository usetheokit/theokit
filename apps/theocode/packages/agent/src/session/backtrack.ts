import { existsSync } from 'node:fs'

import { transcriptPath, transcriptRoot } from '@theokit/agents/persistence'
import { forkBeforeUserTurn, listUserTurns } from '@theokit/agents/session'

/**
 * TheoCode wiring over the framework's backtrack primitives (`forkBeforeUserTurn`, `listUserTurns`).
 *
 * The turn rules (tool results, goal continuations, the last `compact_boundary`) and the tolerance
 * for a half-written last line live in `@theokit/agents/session` now. What stays here is what is
 * this product's: the default cwd/root, the zero-based `nth` the TUI ladder uses (the framework
 * counts from 1), and `copied: false` for a session with no transcript.
 */

export interface ForkBeforeResult {
  newId: string
  copied: boolean
  selectedText?: string
}

export async function forkSessionBeforeUserTurn(
  srcId: string,
  newId: string,
  nth: number,
  opts: { cwd?: string; baseDir?: string } = {},
): Promise<ForkBeforeResult> {
  const cwd = opts.cwd ?? process.cwd()
  const root = opts.baseDir ?? transcriptRoot()
  if (!existsSync(transcriptPath(root, cwd, srcId))) return { newId, copied: false }
  if (!Number.isInteger(nth) || nth < 0) {
    throw new RangeError(`backtrack: nth=${String(nth)} out of range`)
  }
  const { selectedText } = await forkBeforeUserTurn(srcId, newId, nth + 1, { cwd, root })
  return { newId, copied: true, selectedText }
}

export async function readUserTurnPreviewsAsync(
  sessionId: string,
  opts: { cwd?: string; baseDir?: string } = {},
): Promise<string[]> {
  const turns = await listUserTurns(sessionId, {
    cwd: opts.cwd ?? process.cwd(),
    root: opts.baseDir ?? transcriptRoot(),
  })
  return turns.map((t) => t.text)
}
