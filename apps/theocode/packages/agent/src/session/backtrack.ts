import { existsSync } from 'node:fs'

import { LiveTranscriptError, transcriptPath, transcriptRoot } from '@theokit/agents/persistence'
import { forkBeforeUserTurn, listUserTurns } from '@theokit/agents/session'

import { protectedSessions } from './session-ops.js'

const defaultBaseDir = transcriptRoot

export interface ForkBeforeResult {
  newId: string
  copied: boolean
  selectedText?: string
}

/**
 * Fork `srcId` into `newId`, keeping everything before the `nth` real user turn (0-based, as the
 * backtrack UI counts). The turn rule, the torn-last-line tolerance and the copy are the framework's
 * `forkBeforeUserTurn`; what stays here is TheoCode's own guard — a destination the
 * framework's `last-session` pointer names is refused first, reading it fail-closed (#1905).
 */
export async function forkSessionBeforeUserTurn(
  srcId: string,
  newId: string,
  nth: number,
  opts: { cwd?: string; baseDir?: string } = {},
): Promise<ForkBeforeResult> {
  const cwd = opts.cwd ?? process.cwd()
  const root = opts.baseDir ?? defaultBaseDir()
  if (!existsSync(transcriptPath(root, cwd, srcId))) return { newId, copied: false }
  if (!Number.isInteger(nth) || nth < 0) {
    throw new RangeError(`backtrack: nth=${String(nth)} out of range`)
  }
  // The framework's out-of-range error is a TheokitAgentError; callers of this adapter have always
  // been told with a RangeError, so the bound is checked here against the same listing.
  const turns = await listUserTurns(srcId, { cwd, root })
  if (nth >= turns.length) {
    throw new RangeError(
      `backtrack: nth=${String(nth)} out of range — ${String(turns.length)} user turn(s) in the window`,
    )
  }
  const destination = transcriptPath(root, cwd, newId)
  if ((await protectedSessions(cwd, root)).includes(destination)) {
    throw new LiveTranscriptError(destination)
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
    root: opts.baseDir ?? defaultBaseDir(),
  })
  return turns.map((t) => t.text)
}
