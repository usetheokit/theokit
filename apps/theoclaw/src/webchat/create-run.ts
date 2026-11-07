import type { StreamEvent } from '@theokit/agents/bridge'

import { describeError } from '../control-plane/errors.js'
import type { TurnEvent, TurnOutcome, TurnRunner } from '../control-plane/turn.js'
import { formatUsageLine, type TurnUsage } from '../usage/turn-usage.js'

/**
 * The event a failed turn ends with when it streamed no error of its own (FR-006): the browser
 * then sees one error, never a stream that simply stops. The presenter masks the message for the
 * client and writes it, unmasked, to the server's stderr.
 */
function turnFailed(reason: string): StreamEvent {
  return { type: 'error', code: 'turn_failed', message: `the turn failed: ${reason}`, retryable: false }
}

const DONE: IteratorReturnResult<undefined> = { done: true, value: undefined }

/**
 * The run's `done` with the turn's usage record (FR-003): the token counts and cost the run
 * reported, the cost left out when the run was unpriced, and the model.
 */
function withUsage(done: StreamEvent, usage: TurnUsage): StreamEvent {
  const { inputTokens, outputTokens } = usage
  const prior = typeof done.usage === 'object' && done.usage !== null ? done.usage : {}
  const enriched: StreamEvent = {
    ...done,
    usage: { ...prior, inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
    model: usage.model,
  }
  if (usage.costUsd === undefined) delete enriched.cost
  else enriched.cost = usage.costUsd
  return enriched
}

/**
 * One turn's events as an async source: a queue the turn's synchronous `emit` fills and the reader
 * drains. Hand-written rather than an async generator (EC-2): a generator suspended on an empty
 * queue would hold a `return()` until its next yield, and a silent model never yields.
 *
 * `return()` resolves at once. It cancels the turn only while the turn has not answered yet: the
 * framework's presenter stops reading at the first `done` or `error` and calls `return()` then, and
 * a turn that has given its answer must not be cancelled for it. The queue is unbounded (EC-12):
 * `emit` cannot wait, and one turn's events are what the model streams for one answer.
 */
function startTurn(
  runTurn: TurnRunner,
  message: string,
  signal: AbortSignal,
  write: (line: string) => void,
): AsyncIterator<StreamEvent> {
  const controller = new AbortController()
  const queue: StreamEvent[] = []
  // The run's `done` and whatever follows it wait for the turn's outcome, which carries the usage.
  let held: { readonly done: StreamEvent; readonly after: StreamEvent[] } | undefined
  let closed = false
  let answered = false
  let sawError = false
  let wake: (() => void) | undefined
  const notify = (): void => {
    wake?.()
    wake = undefined
  }
  const push = (event: TurnEvent): void => {
    if (closed) return
    sawError ||= event.type === 'error'
    answered ||= event.type === 'error' || event.type === 'done'
    if (held !== undefined) held.after.push(event)
    else if (event.type === 'done') held = { done: event, after: [] }
    else queue.push(event)
    notify()
  }
  const release = (usage?: TurnUsage): void => {
    if (held === undefined) return
    queue.push(usage === undefined ? held.done : withUsage(held.done, usage), ...held.after)
    held = undefined
    notify()
  }
  const abort = (): void => controller.abort()
  const close = (): void => {
    release()
    closed = true
    signal.removeEventListener('abort', abort)
    notify()
  }
  controller.signal.addEventListener('abort', close, { once: true })
  if (signal.aborted) abort()
  else signal.addEventListener('abort', abort, { once: true })

  void Promise.resolve()
    .then(() => runTurn(message, push, controller.signal))
    .catch((error: unknown): TurnOutcome => ({ ok: false, code: 'turn_failed', reason: describeError(error) }))
    .then((outcome) => {
      const usage = outcome.ok ? outcome.usage : undefined
      if (usage !== undefined) write(formatUsageLine('webchat', usage))
      release(usage)
      if (!outcome.ok && outcome.code === 'turn_failed' && !sawError) push(turnFailed(outcome.reason))
      close()
    })

  return {
    async next(): Promise<IteratorResult<StreamEvent, undefined>> {
      for (;;) {
        const event = queue.shift()
        if (event !== undefined) return { done: false, value: event }
        if (closed) return DONE
        await new Promise<void>((resolve) => {
          wake = resolve
        })
      }
    },
    async return(): Promise<IteratorResult<StreamEvent, undefined>> {
      if (!answered) abort()
      queue.length = 0
      close()
      return DONE
    },
  }
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
  return (message, chatId) => ({ [Symbol.asyncIterator]: () => startTurn(turnFor(chatId), message, signal, write) })
}
