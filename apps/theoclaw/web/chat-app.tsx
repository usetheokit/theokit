import { useAgent, type UseAgentReturn } from '@theokit/agents/client/react'
import { ChatComposer } from '@theokit/ui/chat-composer'
import { ChatThread } from '@theokit/ui/chat-thread'
import { useState } from 'react'

import { WEBCHAT_API, webchatAgentOptions } from './agent-options.js'
import { readToken, writeToken } from './token-store.js'

type ThreadMessage = UseAgentReturn['thread'][number]

/** A message's text parts joined; the owner's chat needs text, not code highlighting (plan D4). */
function textOf(message: ThreadMessage): string {
  return message.parts
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('')
}

/** The token form: shown until the owner gives the WebChat token. */
function TokenForm({ onToken }: { readonly onToken: (token: string) => void }) {
  const [value, setValue] = useState('')
  const submit = (event: { preventDefault(): void }): void => {
    event.preventDefault()
    // A pasted token often carries a trailing newline; the server compares the exact value.
    const token = value.trim()
    if (token !== '') onToken(token)
  }
  return (
    <form onSubmit={submit}>
      <label>
        WebChat token
        <input type="password" autoComplete="off" value={value} onChange={(event) => setValue(event.target.value)} />
      </label>
      <button type="submit">Open chat</button>
    </form>
  )
}

/** The chat itself: the thread of messages and the composer, over `useAgent`. */
function Chat({ token }: { readonly token: string }) {
  const { thread, send, status, abort } = useAgent(WEBCHAT_API, webchatAgentOptions(token))
  const [draft, setDraft] = useState('')
  const submit = (message: string): void => {
    if (message.trim() === '') return
    setDraft('')
    void send({ message })
  }
  return (
    <main>
      <ChatThread>
        {thread.map((message: ThreadMessage) => (
          <div key={message.id} data-role={message.role}>
            {textOf(message)}
          </div>
        ))}
      </ChatThread>
      <ChatComposer
        value={draft}
        onValueChange={setDraft}
        onSubmit={submit}
        running={status === 'streaming'}
        onStop={abort}
      />
    </main>
  )
}

/** The WebChat page: the token form first, then the chat, with the token kept for the tab (FR-008, FR-009). */
export function ChatApp() {
  const [token, setToken] = useState(readToken)
  const keep = (value: string): void => {
    writeToken(value)
    setToken(value)
  }
  return token === undefined ? <TokenForm onToken={keep} /> : <Chat token={token} />
}
