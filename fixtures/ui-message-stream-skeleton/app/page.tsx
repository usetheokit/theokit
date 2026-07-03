'use client'

import { useChat } from '@ai-sdk/react'
import { useState } from 'react'

/**
 * M0 walking skeleton — `@ai-sdk/react`'s `useChat` against a theokit endpoint,
 * with NO custom adapter.
 *
 * `useChat` points at `/api/chat` (the manually-wired route in
 * server/routes/chat.ts). That route emits the ai-sdk `UIMessageStream` wire
 * (`x-vercel-ai-ui-message-stream: v1` + `data: [DONE]`), so `useChat` parses
 * it out of the box — the whole point of M0. No theokit-specific client code
 * sits between the hook and the stream.
 */
export default function Page() {
  const [draft, setDraft] = useState('')
  const { messages, sendMessage, status } = useChat({ api: '/api/chat' })

  return (
    <main>
      <h1>UIMessageStream skeleton — useChat, no custom adapter</h1>
      <p>
        Status: <code>{status}</code>
      </p>
      <ul>
        {messages.map((message) => (
          <li key={message.id}>
            <strong>{message.role}:</strong>{' '}
            {message.parts
              .filter((part) => part.type === 'text')
              .map((part) => (part.type === 'text' ? part.text : ''))
              .join('')}
          </li>
        ))}
      </ul>
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="Say something…"
      />
      <button
        type="button"
        onClick={() => {
          if (draft.trim()) {
            void sendMessage({ text: draft })
            setDraft('')
          }
        }}
      >
        Send
      </button>
    </main>
  )
}
