'use client'

import {
  ChatThread,
  ChatMessage,
  ChatComposer,
  AgentStreaming,
  AgentErrorCard,
  QuickActionChips,
} from '@theokit/ui'
import { Button, ScrollArea } from '@usetheo/ui'
import { Plus } from 'lucide-react'
import { useState } from 'react'

import { MODEL_NAME, STARTERS } from './chat/constants'
import { useChatTranscript } from './chat/use-transcript'

/**
 * Default scaffold — a working agent chat, composed from @theokit/ui. This file is the presentational
 * VIEW: the transcript + streaming state lives in `useChatTranscript`, the constants in `chat-constants`.
 * Everything FUNCTIONS: the thread streams real replies, `New chat` resets, the starter prompts send real
 * messages, and the error card shows the real error. No fake cost/token meters. Edit `agents/chat.ts` to
 * pick your model / add tools; grow the UI by adding presentational components beside this file.
 */
export default function Page() {
  const [composerValue, setComposerValue] = useState('')
  const { thread, isStreaming, hasError, error, onlyGreeting, sendMessage, reset } =
    useChatTranscript()

  function handleSubmit(value: string) {
    const trimmed = value.trim()
    if (!trimmed) return
    sendMessage(trimmed)
    setComposerValue('')
  }

  function newChat() {
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
