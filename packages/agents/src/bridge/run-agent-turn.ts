/**
 * One cancellable, streamed turn on an agent the caller already holds, ending in a typed outcome.
 *
 * `runAgentTurn` passes `onDelta` to `send`, forwards each update (and each stream message) as an
 * `AgentStreamEvent`, drops a step's finished assistant text when the deltas already streamed it,
 * races every await against the `AbortSignal` (cancelling the run and the iterator without waiting on
 * a cancel that hangs), and fails the turn when the run streamed an `error` event even if `wait()`
 * reports it finished. It never rejects.
 */
import type { AgentStreamEvent } from './agent-stream-events.js'
import {
  type SdkMessage,
  translateInteractionUpdate,
  translateSdkEvent,
} from './event-translator.js'
import { renderTranscript, type OpenAICompatibleRoutesOptions } from './openai-compatible-routes.js'
import type { SdkAgentHandle, SdkSendOptions } from './sdk-adapter.js'

export type AgentTurnOutcome =
  | { ok: true; usage?: { inputTokens: number; outputTokens: number; costUsd?: number } }
  | { ok: false; code: 'turn_failed' | 'turn_cancelled'; reason: string }

export interface RunAgentTurnOptions {
  readonly agent: SdkAgentHandle
  readonly message: string
  readonly runId: string
  readonly emit: (event: AgentStreamEvent) => void
  readonly signal?: AbortSignal
  /** Merged into `send`; `onDelta` and `signal` are always set by `runAgentTurn`. */
  readonly sendOptions?: SdkSendOptions
  /** Rewrite or drop (return `undefined`) an event before it is emitted. Failures are detected first. */
  readonly mapEvent?: (event: AgentStreamEvent) => AgentStreamEvent | undefined
}

const ABORTED = Symbol('aborted')

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true
}

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Fire a cancel without waiting on it: a hung cancel must not hold the turn. */
function cancelRun(run: { cancel?: () => Promise<void> | void } | undefined): void {
  try {
    void Promise.resolve(run?.cancel?.()).catch(() => undefined)
  } catch {
    // a throwing cancel is not the turn's outcome
  }
}

function closeIterator(iterator: AsyncIterator<unknown> | undefined): void {
  try {
    void Promise.resolve(iterator?.return?.()).catch(() => undefined)
  } catch {
    // ignored: the iterator is already abandoned
  }
}

/** Matches text the deltas already streamed against the finished assistant text, in order. */
function createDeltaLedger() {
  let pending = ''
  return {
    streamed(text: string): void {
      pending += text
    },
    /** True when `text` was already streamed (and consumes it). */
    consume(text: string): boolean {
      if (pending !== '' && pending.startsWith(text)) {
        pending = pending.slice(text.length)
        return true
      }
      pending = ''
      return false
    },
  }
}

function rawErrorReason(msg: SdkMessage): string | undefined {
  if (msg.type !== 'error') return undefined
  const code = typeof msg.code === 'string' ? msg.code : 'error'
  const message = typeof msg.message === 'string' ? `: ${msg.message}` : ''
  return `${code}${message}`
}

async function execute(options: RunAgentTurnOptions): Promise<AgentTurnOutcome> {
  const { signal } = options
  const cancelled = (): AgentTurnOutcome => ({
    ok: false,
    code: 'turn_cancelled',
    reason: 'the turn was cancelled',
  })
  if (isAborted(signal)) return cancelled()

  let onAbort: (() => void) | undefined
  const abortion = new Promise<typeof ABORTED>((resolve) => {
    if (signal === undefined) return
    onAbort = () => {
      resolve(ABORTED)
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
  const race = async <T>(work: Promise<T>): Promise<T | typeof ABORTED> => {
    if (signal === undefined) return work
    // the losing branch must never surface as an unhandled rejection
    work.catch(() => undefined)
    if (signal.aborted) return ABORTED
    const result = await Promise.race([work, abortion])
    // an abort that landed while `work` was already settled must still win
    return signal.aborted ? ABORTED : result
  }

  let failure: string | undefined
  const ledger = createDeltaLedger()
  let ended = false
  const emitEvent = (event: AgentStreamEvent): void => {
    if (ended || isAborted(signal)) return
    if (event.type === 'error') failure ??= `${event.code}: ${event.message}`
    const mapped = options.mapEvent === undefined ? event : options.mapEvent(event)
    // mapEvent may itself abort the signal
    if (mapped !== undefined && !ended && !isAborted(signal)) options.emit(mapped)
  }

  let run: Awaited<ReturnType<SdkAgentHandle['send']>> | undefined
  let iterator: AsyncIterator<unknown> | undefined
  try {
    const sending = options.agent.send(options.message, {
      ...options.sendOptions,
      signal,
      onDelta: (delta: { update: Parameters<typeof translateInteractionUpdate>[0] }) => {
        if (ended || isAborted(signal)) return
        const events = translateInteractionUpdate(delta.update) as unknown as AgentStreamEvent[]
        for (const event of events) {
          // tool lifecycle arrives once, through `run.stream()`; deltas carry only text and thinking
          if (event.type !== 'text_delta' && event.type !== 'thinking') continue
          if (event.type === 'text_delta') ledger.streamed(event.content)
          emitEvent(event)
        }
      },
    })
    const sent = await race(sending)
    if (sent === ABORTED) {
      // a run that arrives after the abort is cancelled all the same
      void sending
        .then((late) => {
          cancelRun(late)
        })
        .catch(() => undefined)
      return cancelled()
    }
    run = sent
    if (typeof run.stream !== 'function') {
      return { ok: false, code: 'turn_failed', reason: 'the run exposes no stream' }
    }
    iterator = run.stream()[Symbol.asyncIterator]()
    for (;;) {
      const step = await race(iterator.next())
      if (step === ABORTED) {
        cancelRun(run)
        closeIterator(iterator)
        return cancelled()
      }
      if (step.done === true) break
      const msg = step.value as SdkMessage
      const raw = rawErrorReason(msg)
      if (raw !== undefined) failure ??= raw
      const events = translateSdkEvent(msg, options.runId) as unknown as AgentStreamEvent[]
      for (const event of events) {
        const dropped =
          event.type === 'text_delta' && msg.type === 'assistant' && ledger.consume(event.content)
        if (dropped) continue
        emitEvent(event)
      }
    }
    const done = await race(run.wait())
    if (done === ABORTED) {
      cancelRun(run)
      closeIterator(iterator)
      return cancelled()
    }
    if (failure !== undefined) return { ok: false, code: 'turn_failed', reason: failure }
    if (done.status === 'cancelled') return cancelled()
    if (done.status !== undefined && done.status !== 'finished') {
      return {
        ok: false,
        code: 'turn_failed',
        reason: done.error?.message ?? `run ${done.status}`,
      }
    }
    const usage = done.usage
    if (usage === undefined) return { ok: true }
    const costUsd = done.cost?.amountUsd
    return {
      ok: true,
      usage: {
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        ...(typeof costUsd === 'number' && Number.isFinite(costUsd) ? { costUsd } : {}),
      },
    }
  } catch (err) {
    if (isAborted(signal)) {
      cancelRun(run)
      closeIterator(iterator)
      return cancelled()
    }
    return { ok: false, code: 'turn_failed', reason: failure ?? reasonOf(err) }
  } finally {
    // a late delta from a run whose cancel is slow must not reach a caller that has moved on
    ended = true
    if (onAbort !== undefined) signal?.removeEventListener('abort', onAbort)
  }
}

/** Run one turn; resolves with a typed outcome and never rejects. */
export async function runAgentTurn(options: RunAgentTurnOptions): Promise<AgentTurnOutcome> {
  try {
    return await execute(options)
  } catch (err) {
    return { ok: false, code: 'turn_failed', reason: reasonOf(err) }
  }
}

/**
 * Adapt {@link runAgentTurn} to the `complete` port of `createOpenAICompatibleRoutes`. A turn that
 * fails or is cancelled throws, which the route answers as 502 `turn_failed`.
 */
export function completeFromTurn(
  withAgent: <R>(work: (agent: SdkAgentHandle) => Promise<R>) => Promise<R>,
): OpenAICompatibleRoutesOptions['complete'] {
  return (request, onDelta, signal) =>
    withAgent(async (agent) => {
      let text = ''
      const outcome = await runAgentTurn({
        agent,
        message: renderTranscript(request.messages),
        runId: globalThis.crypto.randomUUID(),
        ...(signal === undefined ? {} : { signal }),
        emit: (event) => {
          if (event.type !== 'text_delta') return
          text += event.content
          onDelta?.(event.content)
        },
      })
      if (!outcome.ok) throw new Error(outcome.reason)
      return {
        text,
        ...(outcome.usage === undefined
          ? {}
          : {
              usage: {
                promptTokens: outcome.usage.inputTokens,
                completionTokens: outcome.usage.outputTokens,
              },
            }),
      }
    })
}
