'use client'

import { type UIMessage } from '@theokit/ui'
import { useEffect, useState } from 'react'
import { useAgent } from 'theokit/client'

import { GREETING } from './constants'

/**
 * Owns the chat transcript — the subtle part of an agent UI, so it lives in a hook, not the view. This is
 * the convergent pattern across AI chat frontends (Vercel ai-chatbot's `use-active-chat`, the AI SDK docs):
 * transcript + streaming state in a hook; the page stays presentational.
 *
 * Why a hook is needed: `useAgent` opens a FRESH stream per send, so its `messages` hold only the CURRENT
 * turn (with no stable id). We OWN the full transcript here — `history` accumulates each finished turn with
 * our own unique ids, and the in-flight reply is shown live until it commits: correct order, complete
 * history, unique keys.
 */
export interface ChatTranscript {
  /** The full transcript to render (committed history + the in-flight reply while streaming). */
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
  const [history, setHistory] = useState<UIMessage[]>([GREETING])
  const {
    messages,
    send,
    status,
    reset: resetAgent,
    error,
  } = useAgent<{ message: string }>('/api/agents/chat')

  const isStreaming = status === 'streaming'
  const users = history.filter((m) => m.role === 'user').length
  const replies = history.filter((m) => m.role === 'assistant' && m.id !== 'greeting').length
  // A sent prompt is still awaiting its committed reply — the current turn is "in flight".
  const pending = users > replies

  // Merge the in-flight turn's parts into ONE assistant message with our own unique id (the SDK's ids are
  // empty, which would collide). `suffix` distinguishes the live copy from the committed one.
  const inflightReply = (suffix: string): UIMessage => ({
    id: `a-${String(replies)}${suffix}`,
    role: 'assistant',
    parts: messages.flatMap((m) => m.parts),
  })

  // Commit the finished reply into history exactly once (the next send resets `messages`). Deps are the
  // stream-transition inputs; `inflightReply` is deliberately NOT a dep — it's a fresh closure each render
  // that would re-fire the effect, and it only reads `messages`/`replies`, which ARE deps. (If you enable
  // the `react-hooks/exhaustive-deps` lint rule, add an eslint-disable for this line.)
  useEffect(() => {
    if (!isStreaming && pending && messages.length > 0) {
      setHistory((h) => [...h, inflightReply('')])
    }
  }, [isStreaming, pending, messages, replies])

  // Transcript = committed history + the in-flight reply (shown until it commits — no flicker, no double).
  const thread = pending && messages.length > 0 ? [...history, inflightReply('-live')] : history

  return {
    thread,
    isStreaming,
    hasError: status === 'error',
    error,
    onlyGreeting: history.length === 1 && !isStreaming,
    sendMessage(text) {
      setHistory((h) => [
        ...h,
        { id: `u-${String(h.length)}`, role: 'user', parts: [{ type: 'text', text }] },
      ])
      send({ message: text })
    },
    reset() {
      setHistory([GREETING])
      resetAgent()
    },
  }
}
