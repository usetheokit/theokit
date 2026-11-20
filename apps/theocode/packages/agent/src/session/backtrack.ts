import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import { transcriptPath, transcriptRoot } from '@theokit/agents/persistence'
import { TheokitAgentError } from '@theokit/agents'
import { forkBeforeUserTurn, listUserTurns } from '@theokit/agents/session'

import { protectedSessions } from './session-ops.js'

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
  // The framework's guard does not know the TUI pointer (`<cwd>/.theokit/tui-session`, #1905), so a
  // fork onto the session a TUI points at must be refused here, before anything is written.
  const dst = transcriptPath(root, cwd, newId)
  if ((await protectedSessions(cwd, root)).includes(dst)) {
    throw new TheokitAgentError(
      `refusing to fork onto ${newId}: it is a live session (the one this directory points at, the most recent one, or one holding a writer lease).`,
    )
  }
  mkdirSync(dirname(dst), { recursive: true })
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
