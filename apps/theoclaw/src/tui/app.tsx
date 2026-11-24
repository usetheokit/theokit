import {
  type AgentStreamSource,
  AgentStreaming,
  ChatComposer,
  ChatMessage,
  InkInputProvider,
  Notice,
  Stack,
  TheoTUIProvider,
  ToolCallCard,
  useAgentStream,
} from '@theokit/tui'
import { createControlStreamInbox, createControlStreamSource, type ControlStreamSource } from '@theokit/agents/control'
import { createCommandRegistry, defineCommand } from '@theokit/agents/commands'
import { Text, useInput } from 'ink'
import { type ReactElement, useRef, useState } from 'react'

import { type ControlClient, nextArrival } from '../control-client/control-client.js'
import { nextSessionId, type TuiNotice } from './frames.js'

export interface TheoClawTuiProps {
  /** The connection to the running instance; the TUI builds no agent (plan D1). */
  readonly client: ControlClient
  /** The session it joins first; `/new` moves to `<session>-<n>`. */
  readonly session: string
  /** Called by `/quit`, after the client closed. */
  readonly onExit: () => void
}

/** What the terminal's own commands act on; the component supplies it on each submit. */
interface TuiActions {
  readonly interrupt: () => void
  readonly fresh: () => void
  readonly quit: () => void
}

// `exact`: `/new chat` is a message to the agent, not a new session.
const COMMANDS = createCommandRegistry<TuiActions>([
  defineCommand<TuiActions>({ name: 'interrupt', description: 'stop the running turn (same as Esc)', exact: true, run: (_arg, actions) => actions.interrupt() }),
  defineCommand<TuiActions>({ name: 'new', description: 'start a fresh session', exact: true, run: (_arg, actions) => actions.fresh() }),
  defineCommand<TuiActions>({ name: 'quit', description: 'close the connection and exit', exact: true, run: (_arg, actions) => actions.quit() }),
])
const PALETTE = COMMANDS.palette()

/** One line of the transcript; a turn folds its own text and tools through `useAgentStream`. */
type Item =
  | { readonly kind: 'user'; readonly text: string }
  | ({ readonly kind: 'notice' } & TuiNotice)
  | {
      readonly kind: 'turn'
      readonly id: number
      readonly source: AgentStreamSource
    }

function Turn({ source }: { readonly source: AgentStreamSource }): ReactElement {
  const { events } = useAgentStream(source)
  return (
    <>
      {events.map((event) => {
        if (event.kind === 'notice')
          return (
            <Notice key={event.id} variant={event.variant}>
              {event.text}
            </Notice>
          )
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
    if (running.current) current.current?.interrupt()
  }

  const turns = useRef(0)
  const current = useRef<ControlStreamSource | undefined>(undefined)
  const inbox = useRef<ReturnType<typeof createControlStreamInbox> | undefined>(undefined)
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
    const mine = createControlStreamInbox({ stamp: nextArrival })
    inbox.current = mine
    // What is left once the framework ended the fold (a notice posted after the interruption) goes below the turn.
    const inTurn = (n: TuiNotice): void => setItems((current) => [...current, { kind: 'notice', ...n }])
    const onEnd = (): void => {
      running.current = false
      setBusy(false)
      const next = queued.current
      queued.current = undefined
      if (next !== undefined) send(next)
    }
    // A function source: the hook starts the turn when it mounts, so the stream is opened exactly once.
    const source = createControlStreamSource(client, session, text, {
      inbox: mine,
      onNotice: inTurn,
      onEnd,
    })
    current.current = source
    setItems((current) => [
      ...current,
      { kind: 'user', text },
      { kind: 'turn', id, source },
    ])
  }

  useInput((_input, key) => {
    if (key.escape) interrupt()
  })

  const actions: TuiActions = {
    interrupt,
    quit: () => void client.close().then(onExit),
    fresh: () => {
      // The running turn stays on this session: switching now would leave Esc nothing to stop.
      if (running.current) return notice({ variant: 'warning', text: 'a turn is running: press Esc first' })
      fresh.current += 1
      setSession(nextSessionId(base, fresh.current))
      setItems([])
    },
  }

  const submit = (text: string): void => {
    const trimmed = text.trim()
    if (trimmed === '') return
    const routed = COMMANDS.route(trimmed)
    if (routed.kind === 'command') {
      // Run in place, not through `dispatch`: a command's effect lands before the next keystroke.
      void routed.command.run?.(routed.arg, actions)
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
            commands={PALETTE}
            placeholder="Message TheoClaw"
          />
          <Text dimColor>session {session}</Text>
        </Stack>
      </InkInputProvider>
    </TheoTUIProvider>
  )
}
