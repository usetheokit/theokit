'use client'

import { useAgent, type UIMessage } from 'theokit/client'

import { GREETING } from '../lib/constants'

/**
 * Owns the chat transcript for the view. Since M46, the framework's client store accumulates the full
 * conversation `thread` (committed turns + the in-flight streaming reply, with stable ids), so this hook
 * is a thin projection: prepend the warm greeting and map status to the flags the UI reads. The 88-line
 * hand-rolled transcript (local history + commit-once effect + inflight-merge) is gone — the store owns it.
 */
export interface ChatTranscript {
  /**
   * The full transcript (greeting + committed history + the in-flight reply while streaming).
   *
   * Typed as the framework's `UIMessage` — the shape `useAgent` actually returns — and NOT as the
   * component library's. Two earlier versions of this template typed it as the renderer's type and
   * a fresh scaffold failed its own `typecheck` (usetheokit/theokit#80, #396). `app/lib/renderable.ts`
   * converts at the one place that renders.
   */
  thread: UIMessage[]
  isStreaming: boolean
  hasError: boolean
  error: Error | undefined
  /** True while only the greeting is shown — drives the starter prompts. */
  onlyGreeting: boolean
  /** Append the user's message and start a new agent turn. */
  sendMessage: (text: string) => void
  /** Clear the transcript back to the greeting and cancel any in-flight stream. */
  reset: () => void
}

export function useChatTranscript(): ChatTranscript {
  const { thread, send, status, reset, error } = useAgent<{ message: string }>('/api/agents/chat')
  return {
    thread: [GREETING, ...thread],
    isStreaming: status === 'streaming',
    hasError: status === 'error',
    error,
    onlyGreeting: thread.length === 0 && status !== 'streaming',
    sendMessage: (text) => send({ message: text }),
    reset,
  }
}
