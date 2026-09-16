import { readThreadMessages } from '@theocode/agent/session'
import { useEffect, useState } from 'react'

import type { UIMessageLike } from '@theokit/tui'

import { workingDirectory } from '../working-directory.js'
import { historyToThread, type StoredMessage } from './history-to-thread.js'

/** The read, injected so the effect's branches are testable without a transcript on disk. */
type ReadHistory = (
  sessionId: string,
  onWarn?: (message: string) => void,
) => Promise<readonly StoredMessage[]>

const defaultRead: ReadHistory = async (sessionId, onWarn) =>
  readThreadMessages(sessionId, workingDirectory(), onWarn)

/**
 * The turns a resumed session already contains, ready for the timeline (#70).
 *
 * ONLY for a resume. A session that was just created has nothing to read, and reading anyway would
 * spend a file walk per new session to learn that — worse, a hook that read unconditionally would
 * pass the anti-vacuity case in the test file and still be wrong.
 *
 * Asynchronous on purpose: the surface stays usable while the transcript parses. `useTimeline` keys
 * its frame budget on this value too, so a history that lands after mount still repaints — a resume
 * that froze the TUI until a transcript parsed would trade one bad outcome for a worse one.
 *
 * The id change CLEARS before it re-reads. Leaving the previous session's turns on screen under the
 * new one's greeting attributes work to a conversation that did not contain it, which is a worse
 * failure than the empty screen this exists to fix.
 */
export function useResumedHistory(
  sessionId: string | undefined,
  resumed: boolean,
  read: ReadHistory = defaultRead,
): readonly UIMessageLike[] {
  const [history, setHistory] = useState<readonly UIMessageLike[]>([])

  useEffect(() => {
    if (!resumed || sessionId === undefined) {
      setHistory([])
      return
    }
    // `cancelled` rather than an AbortController: the read is a file parse, not a request, and what
    // needs guarding is the STATE WRITE after a session switch — an in-flight read for the previous
    // id must not land on the new one's screen.
    let cancelled = false
    setHistory([])
    void read(sessionId, (message) => process.stderr.write(`[resume] ${message}\n`)).then(
      (messages) => {
        if (!cancelled) setHistory(historyToThread(messages))
      },
    )
    return () => {
      cancelled = true
    }
  }, [sessionId, resumed, read])

  return history
}
