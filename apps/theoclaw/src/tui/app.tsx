import {
  AgentSession,
  type AgentSessionCommand,
  InkInputProvider,
  StatusFooter,
  TheoTUIProvider,
} from '@theokit/tui'
import { type ReactElement, useMemo, useRef, useState } from 'react'

import type { ControlClient } from '../control-client/control-client.js'
import { controlStream, nextSessionId } from './frames.js'

export interface TheoClawTuiProps {
  /** The connection to the running instance; the TUI builds no agent (plan D1). */
  readonly client: ControlClient
  /** The session it joins first; `/new` moves to `<session>-<n>`. */
  readonly session: string
  /** Called by `/quit`, after the client closed. */
  readonly onExit: () => void
}

/**
 * TheoClaw's terminal UI (FR-009): the framework's session screen over the running instance. Every turn
 * is the instance's, on the session shown in the footer; Esc interrupts it and a message typed meanwhile
 * is queued by the screen. `/new` stops the running turn and remounts the screen on a fresh session.
 */
export function TheoClawTui({ client, session: base, onExit }: TheoClawTuiProps): ReactElement {
  const [session, setSession] = useState(base)
  const fresh = useRef(0)

  const commands = useMemo<readonly AgentSessionCommand[]>(
    () => [
      {
        name: 'interrupt',
        description: 'stop the running turn (same as Esc)',
        run: (_args, controls) => controls.interrupt(),
      },
      {
        name: 'new',
        description: 'start a fresh session',
        run: (_args, controls) => {
          controls.interrupt()
          fresh.current += 1
          setSession(nextSessionId(base, fresh.current))
        },
      },
      {
        name: 'quit',
        description: 'close the connection and exit',
        run: () => void client.close().then(onExit),
      },
    ],
    [base, client, onExit],
  )

  // The screen keeps the first `stream` it was given per turn through a ref, so one per session is enough.
  const stream = useMemo(
    () => (message: string, signal: AbortSignal) => controlStream(client, message, session, signal),
    [client, session],
  )

  return (
    <TheoTUIProvider>
      <InkInputProvider>
        <AgentSession
          key={session}
          stream={stream}
          commands={commands}
          placeholder="Message TheoClaw"
          renderFooter={({ queued }) => (
            <StatusFooter
              hint={`session ${session}${queued > 0 ? ` · ${queued} queued` : ''} · esc to interrupt`}
            />
          )}
        />
      </InkInputProvider>
    </TheoTUIProvider>
  )
}
