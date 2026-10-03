import { useCallback, useState } from 'react'

import type { UIMessageLike } from '@theokit/tui'

/**
 * #948: what the transcript says under a reply the user stopped with Esc. The interrupt cut the
 * stream and nothing recorded it, so a partial answer read as a finished one. Claude Code's wording.
 */
export const INTERRUPTED_TEXT = 'Interrupted by user'

/**
 * The message an interrupt cuts: the reply being streamed, or the request itself when no reply has
 * started yet.
 */
export function lastMessageId(thread: readonly UIMessageLike[]): string | undefined {
  return thread.at(-1)?.id
}

/**
 * The thread with a marker after every interrupted message. The marker is a `system` line, so the
 * paths that read the last assistant text (copy, export) never take it for the answer.
 */
export function withInterruptMarks(
  messages: readonly UIMessageLike[],
  interrupted: ReadonlySet<string>,
): UIMessageLike[] {
  if (interrupted.size === 0) return [...messages]
  return messages.flatMap((m) =>
    interrupted.has(m.id)
      ? [
          m,
          {
            id: `${m.id}:interrupted`,
            role: 'system' as const,
            parts: [{ type: 'text', text: INTERRUPTED_TEXT }],
          },
        ]
      : [m],
  )
}

/** The ids of the messages this session interrupted, kept for the life of the screen. */
export function useInterruptMarks(): {
  readonly interrupted: ReadonlySet<string>
  readonly mark: (id: string | undefined) => void
} {
  const [interrupted, setInterrupted] = useState<ReadonlySet<string>>(() => new Set())
  const mark = useCallback((id: string | undefined) => {
    if (id === undefined) return
    setInterrupted((prev) => new Set(prev).add(id))
  }, [])
  return { interrupted, mark }
}
