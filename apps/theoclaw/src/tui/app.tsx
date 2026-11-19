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
import {
  controlStream,
  createTurnInbox,
  nextSessionId,
  type TranscriptEntry,
  type TurnInbox,
  type TuiNotice,
  type TurnNotice,
  turnEntries,
} from './frames.js'

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
  | {
      readonly kind: 'turn'
      readonly id: number
      readonly source: AgentStreamSource
      readonly notices: readonly TurnNotice[]
      /** Set when the turn was interrupted: the local reducer's transcript, drawn instead of the framework's fold. */
      readonly frozen?: readonly TranscriptEntry[]
    }

function Turn({
  source,
  notices,
  frozen,
}: {
  readonly source: AgentStreamSource
  readonly notices: readonly TurnNotice[]
  readonly frozen?: readonly TranscriptEntry[]
}): ReactElement {
  const { events } = useAgentStream(source)
  if (frozen !== undefined) {
    return (
      <>
        {frozen.map((entry, index) => {
          if (entry.kind === 'assistant')
            return (
              <ChatMessage key={index} role="assistant">
                {entry.text}
              </ChatMessage>
            )
          if (entry.kind === 'tool')
            return <ToolCallCard key={index} name={entry.name} status={entry.status} />
          if (entry.kind === 'notice')
            return (
              <Notice key={index} variant={entry.variant}>
                {entry.text}
              </Notice>
            )
          return null
        })}
      </>
    )
  }
  return (
    <>
      {turnEntries(events, notices).map((entry, index) => {
        if (entry.kind === 'notice')
          return (
            <Notice key={`n${index}`} variant={entry.variant}>
              {entry.text}
            </Notice>
          )
        const { event } = entry
        if (event.kind === 'message')
          return (
            <ChatMessage key={event.id} role={event.role}>
              {event.text}
            </ChatMessage>
          )
        if (event.kind === 'tool')
          return <ToolCallCard key={event.id} name={event.name} status={event.status} />
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
      return <Turn source={item.source} notices={item.notices} frozen={item.frozen} />
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

  const turns = useRef(0)
  const inbox = useRef<TurnInbox | undefined>(undefined)
  // While a turn runs a notice goes to its stream, which places it where the turn has reached, so later output stays below it.
  const notice = (n: TuiNotice): void => {
    if (running.current && inbox.current !== undefined) inbox.current.post(n)
    else setItems((current) => [...current, { kind: 'notice', ...n }])
  }

  const send = (text: string): void => {
    turns.current += 1
    const id = turns.current
    running.current = true
    setBusy(true)
    const mine = createTurnInbox()
    inbox.current = mine
    const update = (change: (item: Item & { kind: 'turn' }) => Item): void =>
      setItems((current) =>
        current.map((item) => (item.kind === 'turn' && item.id === id ? change(item) : item)),
      )
    const inTurn = (n: TurnNotice): void =>
      update((item) => ({ ...item, notices: [...item.notices, n] }))
    const onInterrupted = (frozen: readonly TranscriptEntry[]): void =>
      update((item) => ({ ...item, frozen }))
    const onEnd = (): void => {
      running.current = false
      setBusy(false)
      const next = queued.current
      queued.current = undefined
      if (next !== undefined) send(next)
    }
    // A function source: the hook starts the turn when it mounts, so the stream is opened exactly once.
    const source: AgentStreamSource = () =>
      controlStream(client, text, session, inTurn, onEnd, mine, onInterrupted)
    setItems((current) => [
      ...current,
      { kind: 'user', text },
      { kind: 'turn', id, source, notices: [] },
    ])
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
      if (running.current)
        return notice({ variant: 'warning', text: 'a turn is running: press Esc first' })
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
          <ChatComposer
            onSubmit={submit}
            multiLine
            commands={COMMANDS}
            placeholder="Message TheoClaw"
          />
          <Text dimColor>session {session}</Text>
        </Stack>
      </InkInputProvider>
    </TheoTUIProvider>
  )
}
