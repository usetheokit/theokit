import {
  AgentSession,
  type AgentStreamEvent,
  type AgentSessionCommand,
  type AgentSessionFooterInfo,
  InkInputProvider,
  Stack,
  StatusFooter,
  TheoTUIProvider,
} from '@theokit/tui'
import { createControlStreamSource } from '@theokit/agents/control'
import { createCommandRegistry, defineCommand } from '@theokit/agents/commands'
import { Text } from 'ink'
import { type ReactElement, useRef, useState } from 'react'

import type { ControlClient } from '../control-client/control-client.js'
import { createTurnInbox, nextSessionId, type TurnInbox } from './frames.js'

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

interface SessionProps {
  readonly client: ControlClient
  readonly session: string
  /** Resolves when the connection's last chat, on this or an earlier session, has finished unwinding. */
  readonly previous: { current: Promise<void> }
  readonly onFresh: () => void
  readonly onQuit: () => void
}

/** One session's screen: remounted (by `key`) when `/new` moves to another session, which clears it. */
function Session({ client, session, previous, onFresh, onQuit }: SessionProps): ReactElement {
  // The turn the stream is on, for the notices and the refusal of `/new` while it runs.
  const turn = useRef<{ readonly inbox: TurnInbox; readonly signal: AbortSignal; ended: boolean } | undefined>(undefined)

  const stream = (message: string, signal: AbortSignal): AsyncIterable<AgentStreamEvent> => {
    const inbox = createTurnInbox()
    const mine = { inbox, signal, ended: false }
    // A function source: the turn is opened when the session consumes it, exactly once.
    const source = createControlStreamSource(client, session, message, { inbox })
    const onAbort = (): void => source.interrupt()
    return (async function* () {
      // The connection runs one chat at a time and the session starts the next turn as soon as Esc
      // is pressed (or `/new` remounts it), so a turn waits for the chat before it, on any session,
      // to finish unwinding on the instance. Taken when the stream starts, so a stream that is
      // closed before it runs leaves the chain alone.
      const after = previous.current
      let finished!: () => void
      previous.current = new Promise<void>((resolve) => (finished = resolve))
      turn.current = mine
      try {
        await after
        if (!signal.aborted) {
          signal.addEventListener('abort', onAbort, { once: true })
          yield* source()
        }
      } finally {
        signal.removeEventListener('abort', onAbort)
        mine.ended = true
        finished()
      }
    })()
  }

  const commands: readonly AgentSessionCommand[] = PALETTE.map(({ name, description }) => ({
    name,
    description,
    run: (args, controls) => {
      // The session matches by name; the registry decides what is a command (`/new chat` is a message).
      const text = args === '' ? `/${name}` : `/${name} ${args}`
      const routed = COMMANDS.route(text)
      if (routed.kind !== 'command') return controls.send(text)
      void routed.command.run?.(routed.arg, {
        interrupt: controls.interrupt,
        quit: onQuit,
        fresh: () => {
          const running = turn.current
          // The running turn stays on this session: switching now would leave Esc nothing to stop.
          if (running !== undefined && !running.ended && !running.signal.aborted) {
            running.inbox.post({ variant: 'warning', text: 'a turn is running: press Esc first' })
            return
          }
          onFresh()
        },
      })
    },
  }))

  const footer = ({ running, queued }: AgentSessionFooterInfo): ReactElement => (
    <StatusFooter
      {...(running ? { hint: queued > 0 ? `${queued} queued · esc to interrupt` : 'esc to interrupt' } : {})} right={<Text dimColor>session {session}</Text>} />
  )

  return <AgentSession stream={stream} commands={commands} renderFooter={footer} placeholder="Message TheoClaw" />
}

/**
 * TheoClaw's terminal UI (FR-009): the framework's `AgentSession` (transcript, streaming indicator,
 * composer with slash completion, Esc to interrupt, a message typed during a turn queued) on the
 * running instance's turns, on the session shown in the footer.
 */
export function TheoClawTui({ client, session: base, onExit }: TheoClawTuiProps): ReactElement {
  const [fresh, setFresh] = useState(0)
  const session = fresh === 0 ? base : nextSessionId(base, fresh)
  const previous = useRef<Promise<void>>(Promise.resolve())
  return (
    <TheoTUIProvider>
      <InkInputProvider>
        <Stack gap={1}>
          <Session
            key={session}
            client={client}
            session={session}
            previous={previous}
            onFresh={() => setFresh((n) => n + 1)}
            onQuit={() => void client.close().then(onExit)}
          />
        </Stack>
      </InkInputProvider>
    </TheoTUIProvider>
  )
}
