import { useMemo } from 'react'

import { readTurnUsage, useCoalesced, type UIMessageLike } from '@theokit/tui'

import { formatToolHeader, formatToolResult } from '../formatting/index.js'
import { latestUsage } from '../formatting/index.js'
import { TUI_MAX_FPS, coalesceWindowMs } from './frame-budget.js'
import { greetingFor } from './resumed-banner.js'
import { deriveTimeline, prepareThread } from './timeline-memo.js'

interface AgentWithThread {
  thread: Parameters<typeof prepareThread>[0]
}

export interface TuiTimeline {
  readonly events: ReturnType<typeof deriveTimeline>
  readonly lastUsage: ReturnType<typeof readTurnUsage> | undefined
}

export function useTimeline(
  agent: AgentWithThread,
  resumed: boolean,
  /**
   * What the session already contained, for a resume (#70).
   *
   * A PREFIX, not a seed into `agent.thread`: the thread is the live fold and is replaced wholesale
   * when the stream reconnects, so history seeded into it would vanish on the first reconnect. It was
   * never part of the fold, so nothing resets it.
   *
   * Defaulted to empty because every non-resumed session goes through this same path, and a required
   * argument there would be call sites passing `[]` to say nothing.
   */
  history: readonly UIMessageLike[] = [],
): TuiTimeline {
  const greeting: UIMessageLike = {
    id: 'greeting',
    role: 'assistant',
    parts: [
      {
        type: 'text',
        text: greetingFor(resumed),
      },
    ],
  }
  const coalesceKey = useMemo(() => [agent.thread, history], [agent.thread, history])
  const events = useCoalesced(
    () =>
      deriveTimeline([greeting, ...history, ...prepareThread(agent.thread)], {
        formatToolHeader,
        formatToolResult,
      }),
    // Both inputs, so a history that arrives AFTER mount — the read is asynchronous — still
    // repaints. Keying on the thread alone left a resumed screen empty until the next turn.
    //
    // Memoised rather than an inline `[a, b]`: `useCoalesced` takes ONE key and compares it by
    // identity, so a fresh array every render is a key that always differs — which does not recompute
    // more, it defeats the frame budget and returns the value from the window that never closed.
    // Measured: the timeline came back empty.
    coalesceKey,
    // Explicit rather than defaulted: the library's 34ms equals ceil(1000/30) only while
    // TUI_MAX_FPS is 30, and the window must follow the frame rate rather than shadow it.
    { windowMs: coalesceWindowMs(TUI_MAX_FPS) },
  )
  const lastUsage = useMemo(() => latestUsage(agent.thread, readTurnUsage), [agent.thread])
  return { events, lastUsage }
}
