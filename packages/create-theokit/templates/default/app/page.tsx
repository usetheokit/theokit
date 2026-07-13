'use client'

import { useState } from 'react'

import { ChatPanel } from './components/ChatPanel'
import { Composer } from './components/Composer'
import { useChatTranscript } from './hooks/use-transcript'

/**
 * Default scaffold — a working agent chat. This route is the composition root: it owns the composer's input
 * value + the submit / new-chat handlers, pulls transcript state from `useChatTranscript`, and lays out the
 * two presentational pieces (`ChatPanel` + `Composer`). Everything FUNCTIONS: the thread streams real
 * replies, `New chat` resets, and the starter prompts send real messages. Edit `agents/chat.ts` to pick
 * your model / add tools; grow the UI by adding components under `app/components/`.
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
      <ChatPanel
        thread={thread}
        isStreaming={isStreaming}
        onlyGreeting={onlyGreeting}
        onStarter={handleSubmit}
      />
      <Composer
        value={composerValue}
        onValueChange={setComposerValue}
        onSubmit={handleSubmit}
        running={isStreaming}
        hasError={hasError}
        error={error}
        onNewChat={newChat}
      />
    </>
  )
}
