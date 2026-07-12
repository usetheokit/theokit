'use client'

import { useEffect, useState } from 'react'
import {
  ChatThread,
  ChatMessage,
  ChatComposer,
  AgentStreaming,
  AgentErrorCard,
  QuickActionChips,
  type UIMessage,
  type QuickAction,
} from '@theokit/ui'
import { Button, ScrollArea } from '@usetheo/ui'
import { Plus, Sparkles } from 'lucide-react'
import { useAgent } from 'theokit/client'

/**
 * Default scaffold — a working agent chat, composed from TheoUI. Everything here FUNCTIONS: the thread
 * streams real replies, `New chat` resets, the starter prompts send real messages, and the error card shows
 * the real error. No fake cost/token meters.
 *
 * `useAgent` opens a FRESH stream per send — its `messages` hold only the CURRENT turn (with no stable id),
 * so we OWN the transcript: `history` accumulates each finished turn with our own unique ids, and the
 * in-flight reply is shown live until it commits (correct order, complete history, unique ids). Edit
 * `agents/chat.ts` to pick your model / add tools.
 */

const MODEL_NAME = 'gpt-4o-mini'

/** The agent's opening line — so the conversation starts warm instead of empty. */
const GREETING: UIMessage = {
  id: 'greeting',
  role: 'assistant',
  parts: [
    { type: 'text', text: "Hi — I'm your TheoKit agent. Ask me anything and I'll stream a reply." },
  ],
}

/** Honest starter prompts — each sends a real message the scaffold agent can actually answer. */
const STARTERS: QuickAction[] = [
  { id: 'help', label: 'What can you help me with?', icon: Sparkles },
  { id: 'haiku', label: 'Write a haiku about TypeScript', icon: Sparkles },
  { id: 'async', label: 'Explain async/await in one paragraph', icon: Sparkles },
]

export default function Page() {
  const [composerValue, setComposerValue] = useState('')
  const [history, setHistory] = useState<UIMessage[]>([GREETING])
  const { messages, send, status, reset, error } = useAgent<{ message: string }>('/api/agents/chat')

  const isStreaming = status === 'streaming'
  const hasError = status === 'error'

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

  // Commit the finished reply into history exactly once (the next send resets `messages`).
  useEffect(() => {
    if (!isStreaming && pending && messages.length > 0) {
      setHistory((h) => [...h, inflightReply('')])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStreaming, pending, messages, replies])

  // Transcript = committed history + the in-flight reply (shown until it commits — no flicker, no double).
  const thread = pending && messages.length > 0 ? [...history, inflightReply('-live')] : history
  const onlyGreeting = history.length === 1 && !isStreaming

  function handleSubmit(value: string) {
    const trimmed = value.trim()
    if (!trimmed) return
    setHistory((h) => [
      ...h,
      { id: `u-${String(h.length)}`, role: 'user', parts: [{ type: 'text', text: trimmed }] },
    ])
    send({ message: trimmed })
    setComposerValue('')
  }

  function newChat() {
    setHistory([GREETING])
    reset()
    setComposerValue('')
  }

  return (
    <>
      <ScrollArea className="flex-1">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-6">
          <ChatThread>
            {thread.map((message) => (
              <ChatMessage key={message.id} message={message} />
            ))}
            {isStreaming && <AgentStreaming model={MODEL_NAME} />}
          </ChatThread>
          {onlyGreeting && (
            <QuickActionChips
              actions={STARTERS}
              onSelect={(id) => {
                const action = STARTERS.find((s) => s.id === id)
                if (action && typeof action.label === 'string') handleSubmit(action.label)
              }}
            />
          )}
        </div>
      </ScrollArea>

      <div className="border-border/60 border-t bg-background/50 backdrop-blur">
        <div className="mx-auto w-full max-w-3xl px-6 py-4">
          {hasError && (
            <div className="mb-3">
              <AgentErrorCard
                kind="network"
                title="The agent stream ended with an error"
                detail={error?.message ?? 'Something went wrong. Start a new chat to try again.'}
                actions={
                  <Button variant="ghost" size="sm" onClick={newChat}>
                    New chat
                  </Button>
                }
              />
            </div>
          )}
          <ChatComposer
            value={composerValue}
            onValueChange={setComposerValue}
            onSubmit={handleSubmit}
            running={isStreaming}
            placeholder="Message the agent…"
            leadingActions={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={newChat}
                aria-label="New chat"
                title="New chat"
              >
                <Plus className="size-4" />
              </Button>
            }
          />
        </div>
      </div>
    </>
  )
}
