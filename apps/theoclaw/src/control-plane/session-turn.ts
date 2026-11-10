import {
  createToolSeen,
  flushPendingToolResults,
  type SdkMessage,
  type SdkTimelineEvent,
  translateSdkEvent,
  translateTimelineEvent,
} from '@theokit/agents/bridge'

import type { TurnAgent, TurnRun } from '../agent-port.js'
import { untrustedContentSendOptions } from '../agent/untrusted-content.js'
import { maskSecrets } from '../channels/channel-loop.js'
import { createEventMask } from './event-mask.js'
import { describeStreamedError, outcomeOf, type TurnEvent, type TurnOutcome } from './turn.js'

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
  /** Values no event may carry (`processSecrets`, B-398 FR-007). Default: none. */
  readonly secrets?: readonly string[]
  /** The model the agents run; a finished turn's outcome carries its usage only with it (B-400). */
  readonly model?: string
}

/** Every translated event of the run, live text deltas included; the first streamed error's code. */
async function emitTimeline(run: TurnRun, options: SessionTurnOptions): Promise<string | undefined> {
  let streamedError: string | undefined
  const forward = (events: readonly TurnEvent[]): void => {
    for (const event of events) {
      if (event.type === 'error') streamedError ??= describeStreamedError(event)
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
  const run = await agent.send(options.message, { ...untrustedContentSendOptions(), signal: options.signal })
  options.onRun(run)
  const mask = createEventMask(options.secrets ?? [], options.emit)
  const streamedError = await emitTimeline(run, { ...options, emit: mask.emit })
  // An interrupted turn emits nothing more: what the mask still holds is dropped, never sent.
  if (!options.signal.aborted) mask.flush()
  options.onEventsEnded()
  const model = options.model === undefined ? undefined : maskSecrets(options.model, options.secrets ?? [])
  const outcome = outcomeOf(await run.wait(), streamedError, model)
  // The error's message reaches the log; a configured value inside it is masked there too.
  return outcome.ok ? outcome : { ...outcome, reason: maskSecrets(outcome.reason, options.secrets ?? []) }
}
