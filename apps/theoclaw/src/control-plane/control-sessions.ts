import { createSessionStore, type SessionStore } from '@theokit/agents/control'

import type { TurnAgent } from '../agent-port.js'
import { runSessionTurn } from './session-turn.js'

/** The most `/control` sessions kept open at once (FR-006). */
export const MAX_CONTROL_SESSIONS = 16

/** How long a turn sent to a session waits for that session's cancelled turn to unwind. */
export const CANCEL_DRAIN_MS = 5000

/**
 * What the model is told before the message that follows an interrupted turn. The agent keeps the
 * interrupted message in its history with no answer after it, so the redirect would reach the model
 * beside a request nobody withdrew, and the model goes on with that request instead of answering.
 */
export const REDIRECT_NOTE =
  '[The owner stopped your previous answer and withdrew that request. Do not continue it. Answer only the message below.]\n\n'

export interface ControlSessionsOptions {
  /** Builds one session's agent, on that session's first turn. */
  readonly build: () => Promise<TurnAgent>
  readonly maxSessions?: number
  /** Default {@link CANCEL_DRAIN_MS}. */
  readonly drainMs?: number
  /** Where a disposal that failed outside any turn is written, one line each. */
  readonly report: (line: string) => void
  /** Values no session turn's event may carry (`processSecrets`, B-398 FR-007). Default: none. */
  readonly secrets?: readonly string[]
  /** The model the session agents run; a finished turn's outcome carries its usage only with it (B-400). */
  readonly model?: string
}

export type ControlSessions = SessionStore

/** The agent's disposal through `Symbol.asyncDispose`, the boundary `agent-port.ts` documents. */
async function dispose(agent: TurnAgent): Promise<void> {
  await (agent as Partial<AsyncDisposable>)[Symbol.asyncDispose]?.()
}

/**
 * The `/control` sessions (plan D3): the framework's `createSessionStore` (one kept agent per
 * client-chosen session id, one turn at a time, a bounded number kept, interrupt, steer, a clean
 * close) with the app's turn: the run's timeline through the bridge's translator, secrets masked in
 * every event and in a failure's reason, and the model's usage priced. A refused session id answers
 * `bad_frame`, as the socket always has.
 */
export function createControlSessions(options: ControlSessionsOptions): ControlSessions {
  const secrets = options.secrets ?? []
  return createSessionStore<TurnAgent>({
    build: options.build,
    max: options.maxSessions ?? MAX_CONTROL_SESSIONS,
    drainMs: options.drainMs ?? CANCEL_DRAIN_MS,
    redirectNote: REDIRECT_NOTE,
    report: options.report,
    reportPrefix: 'theoclaw: control session',
    badSessionCode: 'bad_frame',
    closedReason: 'the control plane is closing',
    dispose,
    steerAgent: (agent, message) => agent.send(message, { queueMode: 'steer' }),
    runTurn: (context) =>
      runSessionTurn(context.agent, {
        message: context.message,
        runId: context.runId,
        signal: context.signal,
        emit: context.emit,
        secrets,
        ...(options.model === undefined ? {} : { model: options.model }),
        onRun: (run) => context.onRun(() => run.cancel()),
        onEventsEnded: context.onEventsEnded,
      }),
  })
}
