import { randomUUID } from 'node:crypto'

import { type SdkMessage, translateSdkEvent } from '@theokit/agents/bridge'

import type { TurnAgent, TurnRun } from '../agent-port.js'
import { describeError } from './errors.js'

export type { TurnAgent, TurnRun } from '../agent-port.js'

/** One event as `translateSdkEvent` returns it. */
export type TurnEvent = ReturnType<typeof translateSdkEvent>[number]

/**
 * How a turn ended. `reason` says why a failed or cancelled one ended, for stderr; it is never sent
 * to a client. `turn_cancelled` comes only from a turn given a signal, which the `/control` socket
 * never passes.
 */
export type TurnOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: 'turn_failed' | 'turn_cancelled'; readonly reason: string }

/** Runs `work` with one agent of its own request, as `createContainer().withAgent` does. */
export type WithAgent = <R>(work: (agent: TurnAgent) => Promise<R>) => Promise<R>

export interface TurnOptions {
  readonly withAgent: WithAgent
  readonly message: string
  readonly runId: string
  readonly emit: (event: TurnEvent) => void
  /** Aborted when whoever asked for the turn is gone: the run is cancelled and the turn ends. */
  readonly signal?: AbortSignal
}

/** A turn for one chat message: the message, where each translated event goes, and what cancels it. */
export type TurnRunner = (
  message: string,
  emit: (event: TurnEvent) => void,
  signal?: AbortSignal,
) => Promise<TurnOutcome>

const ABORTED = Symbol('aborted')

function failed(reason: string): TurnOutcome {
  return { ok: false, code: 'turn_failed', reason }
}

function ignore(): void {}

interface AbortWatch {
  /** Resolves once the signal aborts; `undefined` without a signal, so an uncancellable turn races nothing. */
  readonly aborted: Promise<typeof ABORTED> | undefined
  /** Remove the listener, so a signal that outlives the turn does not keep it. */
  release(): void
}

function watchAbort(signal: AbortSignal | undefined): AbortWatch {
  if (signal === undefined) return { aborted: undefined, release: ignore }
  let onAbort: () => void = ignore
  const aborted = new Promise<typeof ABORTED>((resolve) => {
    onAbort = () => resolve(ABORTED)
  })
  signal.addEventListener('abort', onAbort, { once: true })
  return { aborted, release: () => signal.removeEventListener('abort', onAbort) }
}

/**
 * Cancel the run and close its stream without waiting on either (plan D2): a slow or hung SDK
 * cancel must not hold the turn past NFR-004's bound. Whatever rejects within one macrotask turn is
 * kept in the reason; a later rejection is caught and dropped, never left unhandled.
 */
async function cancelRun(run: TurnRun, iterator?: AsyncIterator<unknown>): Promise<TurnOutcome> {
  const reasons: string[] = []
  const keep = (error: unknown): void => void reasons.push(describeError(error))
  const settling = [Promise.resolve().then(() => run.cancel()).then(ignore, keep)]
  if (iterator?.return !== undefined) {
    settling.push(Promise.resolve().then(() => iterator.return?.()).then(ignore, keep))
  }
  await Promise.race([Promise.all(settling), new Promise((resolve) => setImmediate(resolve))])
  return { ok: false, code: 'turn_cancelled', reason: ['the turn was cancelled', ...reasons].join('; ') }
}

/** The next message of the stream, or ABORTED when the signal wins; a losing read is never unhandled. */
function nextOrAbort(
  iterator: AsyncIterator<{ readonly type: string }>,
  aborted: Promise<typeof ABORTED> | undefined,
): Promise<IteratorResult<{ readonly type: string }> | typeof ABORTED> {
  const next = iterator.next()
  if (aborted === undefined) return next
  next.catch(ignore)
  return Promise.race([next, aborted])
}

/**
 * Emit one SDK message's translated events, stopping at the first one after the signal aborted;
 * the code of the first error among them, if any.
 */
function emitMessage(message: { readonly type: string }, options: TurnOptions): string | undefined {
  let streamedError: string | undefined
  for (const event of translateSdkEvent(message as SdkMessage, options.runId)) {
    if (options.signal?.aborted === true) break
    if (event.type === 'error') streamedError ??= String(event.code)
    options.emit(event)
  }
  return streamedError
}

type Streamed = { readonly cancelled: TurnOutcome } | { readonly streamedError: string | undefined }

/**
 * Emit every translated event of the run; the code of the first streamed error, if any. Each read is
 * raced against the signal, so a pending read on a silent stream cannot hold an aborted turn, and
 * nothing is emitted once the signal aborted.
 */
async function streamRun(run: TurnRun, options: TurnOptions, aborted?: Promise<typeof ABORTED>): Promise<Streamed> {
  const iterator = run.stream()[Symbol.asyncIterator]()
  let streamedError: string | undefined
  let closed = false
  try {
    for (;;) {
      const step = options.signal?.aborted === true ? ABORTED : await nextOrAbort(iterator, aborted)
      closed = step === ABORTED || step.done === true
      if (step === ABORTED) return { cancelled: await cancelRun(run, iterator) }
      if (step.done === true) return { streamedError }
      // Emitted first, always: the first streamed error is kept, and every event still reaches the caller.
      const error = emitMessage(step.value, options)
      streamedError ??= error
    }
  } finally {
    // A read, a translation or an emit that throws leaves the stream open; close it, as `for await` did.
    if (!closed) void Promise.resolve().then(() => iterator.return?.()).catch(ignore)
  }
}

/**
 * How a run ended, from its final status and the code of the first error it streamed: a streamed
 * error fails the turn even when `wait()` reports it finished. Shared by the sessionless turn and
 * the session turn (`session-turn.ts`).
 */
export function outcomeOf(result: { readonly status: string }, streamedError: string | undefined): TurnOutcome {
  if (streamedError !== undefined) return failed(`the run streamed an error (${streamedError})`)
  return result.status === 'error' ? failed('the run ended with status error') : { ok: true }
}

async function runWith(agent: TurnAgent, options: TurnOptions): Promise<TurnOutcome> {
  const run = await agent.send(options.message)
  // Checked before any listener is added: a listener on a signal that already aborted never fires (EC-1).
  if (options.signal?.aborted === true) return cancelRun(run)
  const watch = watchAbort(options.signal)
  const streamed = await streamRun(run, options, watch.aborted).finally(() => watch.release())
  if ('cancelled' in streamed) return streamed.cancelled
  const { streamedError } = streamed
  return outcomeOf(await run.wait(), streamedError)
}

/**
 * One turn: one agent built inside `withAgent`, one `send`, every SDK message translated and
 * emitted. A translated `done` or `error` is data inside the turn, never its end: the outcome is
 * what the caller turns into the one final frame. A streamed error fails the turn even when `wait()`
 * reports it finished, as B-369's reply handler does. An aborted signal ends the turn with
 * `turn_cancelled`: before the agent is built, none is built; after, the run is cancelled and
 * nothing more is emitted. The turn never throws: a failure anywhere,
 * building or disposing the agent included, is a `turn_failed` outcome carrying its reason. A
 * disposal that throws fails the turn, finished or not: the agent's state is then unknown.
 */
export async function runTheoClawTurn(options: TurnOptions): Promise<TurnOutcome> {
  if (options.signal?.aborted === true) {
    return { ok: false, code: 'turn_cancelled', reason: 'the turn was cancelled before it started' }
  }
  try {
    return await options.withAgent((agent) => runWith(agent, options))
  } catch (error) {
    return failed(describeError(error))
  }
}

/** The runner the control socket and WebChat call: one fresh run id per turn. */
export function createTurnRunner(withAgent: WithAgent): TurnRunner {
  return (message, emit, signal) =>
    runTheoClawTurn({ withAgent, message, runId: randomUUID(), emit, ...(signal === undefined ? {} : { signal }) })
}
