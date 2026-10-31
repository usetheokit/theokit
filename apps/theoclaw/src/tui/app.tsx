import {
  AgentStreaming,
  ChatComposer,
  type ChatComposerCommand,
  ChatMessage,
  InkInputProvider,
  Notice,
  Stack,
  TheoTUIProvider,
  ToolCallCard,
} from '@theokit/tui'
import { Text, useInput } from 'ink'
import { type ReactElement, useRef, useState } from 'react'

import type { ControlClient } from '../control-client/control-client.js'
import { applyFrame, failTurn, INITIAL_VIEW, nextSessionId, startTurn, type TranscriptEntry, type TuiView } from './frames.js'

export interface TheoClawTuiProps {
  /** The connection to the running instance; the TUI builds no agent (plan D1). */
  readonly client: ControlClient
  /** The session it joins first; `/new` moves to `<session>-<n>`. */
  readonly session: string
  /** Called by `/quit`, after the client closed. */
  readonly onExit: () => void
}

const COMMANDS: readonly ChatComposerCommand[] = [
  { name: 'interrupt', description: 'stop the running turn (same as Esc)' },
  { name: 'new', description: 'start a fresh session' },
  { name: 'quit', description: 'close the connection and exit' },
]

function Entry({ entry }: { readonly entry: TranscriptEntry }): ReactElement {
  switch (entry.kind) {
    case 'user':
      return <ChatMessage role="user">{entry.text}</ChatMessage>
    case 'assistant':
      return <ChatMessage role="assistant">{entry.text}</ChatMessage>
    case 'tool':
      return <ToolCallCard name={entry.name} status={entry.status} />
    case 'notice':
      return <Notice variant={entry.variant}>{entry.text}</Notice>
  }
}

/**
 * TheoClaw's terminal UI (FR-009): multiline input with slash completion, the assistant's text as it
 * is generated, a card per tool call, and Esc to interrupt the running turn so the next message
 * redirects it. Every turn is the running instance's, on the session shown in the footer.
 */
export function TheoClawTui({ client, session: base, onExit }: TheoClawTuiProps): ReactElement {
  const [view, setView] = useState<TuiView>(INITIAL_VIEW)
  const [session, setSession] = useState(base)
  const fresh = useRef(0)
  const running = useRef(false)

  const interrupt = (): void => {
    if (running.current) client.interrupt(session)
  }

  const send = async (text: string): Promise<void> => {
    running.current = true
    setView((current) => startTurn(current, text))
    try {
      for await (const frame of client.chat(text, session)) setView((current) => applyFrame(current, frame))
    } catch (error) {
      setView((current) => failTurn(current, error instanceof Error ? error.message : String(error)))
    } finally {
      running.current = false
    }
  }

  useInput((_input, key) => {
    if (key.escape) interrupt()
  })

  const submit = (text: string): void => {
    const trimmed = text.trim()
    if (trimmed === '') return
    if (trimmed === '/interrupt') return interrupt()
    if (trimmed === '/quit') return void client.close().then(onExit)
    if (trimmed === '/new') {
      fresh.current += 1
      setSession(nextSessionId(base, fresh.current))
      setView(INITIAL_VIEW)
      return
    }
    // One turn at a time: a message typed while one runs waits for Esc or the turn's end.
    if (running.current) return
    void send(text)
  }

  return (
    <TheoTUIProvider>
      <InkInputProvider>
        <Stack gap={1}>
          {view.transcript.map((entry, index) => (
            <Entry key={index} entry={entry} />
          ))}
          {view.running ? <AgentStreaming showCancelHint /> : null}
          <ChatComposer onSubmit={submit} multiLine commands={COMMANDS} placeholder="Message TheoClaw" />
          <Text dimColor>session {session}</Text>
        </Stack>
      </InkInputProvider>
    </TheoTUIProvider>
  )
}
