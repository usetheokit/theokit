import {
  type AgentStreamSource,
  AgentStreaming,
  ChatComposer,
  type ChatComposerCommand,
  ChatMessage,
  InkInputProvider,
  Notice,
  Stack,
  TheoTUIProvider,
  ToolCallCard,
  useAgentStream,
} from '@theokit/tui'
import { Text, useInput } from 'ink'
import { type ReactElement, useRef, useState } from 'react'

import type { ControlClient } from '../control-client/control-client.js'
import { controlStream, nextSessionId, type TuiNotice } from './frames.js'

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

/** One line of the transcript; a turn folds its own text and tools through `useAgentStream`. */
type Item =
  | { readonly kind: 'user'; readonly text: string }
  | ({ readonly kind: 'notice' } & TuiNotice)
  | { readonly kind: 'turn'; readonly source: AgentStreamSource }

function Turn({ source }: { readonly source: AgentStreamSource }): ReactElement {
  const { events } = useAgentStream(source)
  return (
    <>
      {events.map((event) => {
        if (event.kind === 'message') return <ChatMessage key={event.id} role={event.role}>{event.text}</ChatMessage>
        if (event.kind === 'tool') return <ToolCallCard key={event.id} name={event.name} status={event.status} />
        return null
      })}
    </>
  )
}

function Entry({ item }: { readonly item: Item }): ReactElement {
  switch (item.kind) {
    case 'user':
      return <ChatMessage role="user">{item.text}</ChatMessage>
    case 'turn':
      return <Turn source={item.source} />
    case 'notice':
      return <Notice variant={item.variant}>{item.text}</Notice>
  }
}

/**
 * TheoClaw's terminal UI (FR-009): multiline input with slash completion, the assistant's text as it
 * is generated, a card per tool call, and Esc to interrupt the running turn so the next message
 * redirects it. Every turn is the running instance's, on the session shown in the footer.
 */
export function TheoClawTui({ client, session: base, onExit }: TheoClawTuiProps): ReactElement {
  const [items, setItems] = useState<readonly Item[]>([])
  const [session, setSession] = useState(base)
  const fresh = useRef(0)
  const running = useRef(false)
  const [busy, setBusy] = useState(false)
  // A message submitted while a turn runs (a redirect typed right after Esc), sent once it ends.
  const queued = useRef<string | undefined>(undefined)

  const interrupt = (): void => {
    if (running.current) client.interrupt(session)
  }

  const notice = (n: TuiNotice): void => setItems((current) => [...current, { kind: 'notice', ...n }])

  const send = (text: string): void => {
    running.current = true
    setBusy(true)
    const onEnd = (): void => {
      running.current = false
      setBusy(false)
      const next = queued.current
      queued.current = undefined
      if (next !== undefined) send(next)
    }
    // A function source: the hook starts the turn when it mounts, so the stream is opened exactly once.
    const source: AgentStreamSource = () => controlStream(client, text, session, notice, onEnd)
    setItems((current) => [...current, { kind: 'user', text }, { kind: 'turn', source }])
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
      // The running turn stays on this session: switching now would leave Esc nothing to stop.
      if (running.current) return notice({ variant: 'warning', text: 'a turn is running: press Esc first' })
      fresh.current += 1
      setSession(nextSessionId(base, fresh.current))
      setItems([])
      return
    }
    // One turn at a time: a message typed while one runs is sent when it ends (by Esc or by itself).
    if (running.current) {
      queued.current = text
      return notice({ variant: 'warning', text: 'sent when the running turn ends' })
    }
    send(text)
  }

  return (
    <TheoTUIProvider>
      <InkInputProvider>
        <Stack gap={1}>
          {items.map((item, index) => (
            <Entry key={index} item={item} />
          ))}
          {busy ? <AgentStreaming showCancelHint /> : null}
          <ChatComposer onSubmit={submit} multiLine commands={COMMANDS} placeholder="Message TheoClaw" />
          <Text dimColor>session {session}</Text>
        </Stack>
      </InkInputProvider>
    </TheoTUIProvider>
  )
}
