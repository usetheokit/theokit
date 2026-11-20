import { streamFromEmitter, type DoneEvent, type StreamEvent } from '@theokit/agents/bridge'

import { describeError } from '../control-plane/errors.js'
import type { TurnEvent, TurnOutcome, TurnRunner } from '../control-plane/turn.js'
import { formatUsageLine, type TurnUsage } from '../usage/turn-usage.js'

/**
 * The event a failed turn ends with when it streamed no error of its own (FR-006): the browser
 * then sees one error, never a stream that simply stops. The presenter masks the message for the
 * client and writes it, unmasked, to the server's stderr.
 */
function turnFailed(reason: string): TurnEvent {
  return { type: 'error', code: 'turn_failed', message: `the turn failed: ${reason}`, retryable: false }
}

/** The turn's typed event as the wire's `StreamEvent`; the copy carries the index signature the interfaces lack. */
function toStreamEvent(event: TurnEvent): StreamEvent {
  return { ...event }
}

/**
 * The run's `done` with the turn's usage record (FR-003): the token counts and cost the run
 * reported, the cost left out when the run was unpriced, and the model.
 */
function withUsage(done: StreamEvent, usage: TurnUsage): DoneEvent {
  const { inputTokens, outputTokens } = usage
  // A runner's `done` may carry less than the typed event; the missing fields are filled so the
  // event that leaves is always a complete `DoneEvent`.
  const prior = typeof done.usage === 'object' && done.usage !== null ? done.usage : {}
  const enriched: DoneEvent = {
    ...done,
    type: 'done',
    result: typeof done.result === 'string' ? done.result : '',
    durationMs: typeof done.durationMs === 'number' ? done.durationMs : 0,
    usage: { ...prior, inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
    model: usage.model,
  }
  if (usage.costUsd === undefined) delete enriched.cost
  else enriched.cost = usage.costUsd
  return enriched
}

/**
 * One turn's events as an async source (`streamFromEmitter`: `return()` stops the turn at once, even
 * while a read waits on a silent model, and a turn that has already answered is not cancelled for it).
 * The run's `done` and whatever follows it wait for the turn's outcome, which carries the usage.
 */
function startTurn(
  runTurn: TurnRunner,
  message: string,
  signal: AbortSignal,
  write: (line: string) => void,
): AsyncIterable<StreamEvent> {
  return streamFromEmitter<StreamEvent>(
    async (emit, turnSignal) => {
      let held: { readonly done: StreamEvent; readonly after: StreamEvent[] } | undefined
      let sawError = false
      const push = (event: TurnEvent): void => {
        sawError ||= event.type === 'error'
        const wire = toStreamEvent(event)
        if (held !== undefined) held.after.push(wire)
        else if (event.type === 'done') held = { done: wire, after: [] }
        else emit(wire)
      }
      const release = (usage?: TurnUsage): void => {
        if (held === undefined) return
        // Spread: `DoneEvent` is an interface with no index signature, which `StreamEvent` requires.
        emit(usage === undefined ? held.done : { ...withUsage(held.done, usage) })
        for (const event of held.after) emit(event)
        held = undefined
      }
      const outcome = await Promise.resolve()
        .then(() => runTurn(message, push, turnSignal))
        .catch((error: unknown): TurnOutcome => ({ ok: false, code: 'turn_failed', reason: describeError(error) }))
      const usage = outcome.ok ? outcome.usage : undefined
      if (usage !== undefined) write(formatUsageLine('webchat', usage))
      release(usage)
      if (!outcome.ok && outcome.code === 'turn_failed' && !sawError) emit(toStreamEvent(turnFailed(outcome.reason)))
    },
    { signal },
  )
}

/**
 * The `createRun` `generateAgentRoutes` calls: the chat's turn runner (`turnFor`, one session agent per chat id) adapted to the async
 * source the generator streams. Each run's turn is cancelled when `signal` aborts.
 */
export function createWebchatRun(
  turnFor: (chatId: string) => TurnRunner,
  signal: AbortSignal,
  write: (line: string) => void = () => undefined,
): (message: string, sessionId: string) => AsyncIterable<StreamEvent> {
  return (message, chatId) => (startTurn(turnFor(chatId), message, signal, write))
}
