import {
  createToolSeen,
  flushPendingToolResults,
  type SdkMessage,
  type SdkTimelineEvent,
  translateSdkEvent,
  translateTimelineEvent,
} from '@theokit/agents/bridge'

import type { TurnAgent, TurnRun } from '../agent-port.js'
import { outcomeOf, type TurnEvent, type TurnOutcome } from './turn.js'

/** Where a session turn's translated events go, and who learns of the run once it exists. */
export interface SessionTurnOptions {
  readonly message: string
  readonly runId: string
  /** Aborted by an interrupt; the SDK composes it into the run's dispatch signal (plan D2). */
  readonly signal: AbortSignal
  readonly emit: (event: TurnEvent) => void
  /** Called once `send` resolved, so an interrupt that arrives later can also cancel the run. */
  readonly onRun: (run: TurnRun) => void
  /** Called once the run's events ended, before its outcome: an interrupt from here on stops nothing. */
  readonly onEventsEnded: () => void
}

/** Every translated event of the run, live text deltas included; the first streamed error's code. */
async function emitTimeline(run: TurnRun, options: SessionTurnOptions): Promise<string | undefined> {
  let streamedError: string | undefined
  const forward = (events: readonly TurnEvent[]): void => {
    for (const event of events) {
      if (event.type === 'error') streamedError ??= String(event.code)
      options.emit(event)
    }
  }
  if (run.events === undefined) {
    // A run with no timeline (a port implementer older than B-376) still answers, without deltas.
    for await (const message of run.stream()) forward(translateSdkEvent(message as SdkMessage, options.runId))
    return streamedError
  }
  const seen = createToolSeen()
  for await (const event of run.events()) {
    forward(translateTimelineEvent(event as SdkTimelineEvent, options.runId, seen))
  }
  forward(flushPendingToolResults(seen))
  return streamedError
}

/**
 * One turn on a kept session agent: `send` with the turn's own signal, then the run's timeline
 * (`run.events()`, which carries text as it is generated, where `stream()` does not) through the
 * bridge's translator, into the same events the sessionless turn emits. It throws what the agent
 * throws; the session store decides what an interrupted or failed turn answers.
 */
export async function runSessionTurn(agent: TurnAgent, options: SessionTurnOptions): Promise<TurnOutcome> {
  const run = await agent.send(options.message, { signal: options.signal })
  options.onRun(run)
  const streamedError = await emitTimeline(run, options)
  options.onEventsEnded()
  return outcomeOf(await run.wait(), streamedError)
}
