/**
 * One cancellable, streamed turn on an agent the caller already holds, with a typed outcome.
 *
 * Ported from TheoClaw's `runTheoClawTurn`, without its untrusted-content policy: that is a
 * caller hook (`sendOptions`, `mapEvent`). Secret masking is `secrets`.
 */
import type { SDKUserMessage } from '@theokit/sdk'

import type { AgentStreamEvent } from './agent-stream-events.js'
import { createAgentEventMask, type AgentEventMask } from './event-mask.js'
import {
  translateInteractionUpdate,
  translateSdkEvent,
  type SdkMessage,
} from './event-translator.js'
import {
  renderTranscript,
  type OpenAIChatRequest,
  type OpenAICompatibleRoutesOptions,
  type OpenAICompletion,
} from './openai-compatible-routes.js'
import type { SdkAgentHandle, SdkSendOptions } from './sdk-adapter.js'
import { describeError as describe, describeStreamedError } from './stream-errors.js'

/** What one `send` carries: the text alone, or the text with images the model reads on that turn. */
export type AgentTurnMessage = string | SDKUserMessage

/**
 * The run of one turn, as `runAgentTurn` reads it. Looser than `SdkTurnHandle`: a stream message
 * needs only its `type`, and `cancel` and `stream` may be absent.
 */
export interface AgentTurnRun {
  stream?(): AsyncIterable<{ readonly type: string }>
  wait(): Promise<{
    readonly status?: string
    readonly result?: string
    readonly error?: { readonly message?: string; readonly code?: string }
    readonly usage?: { readonly inputTokens?: number; readonly outputTokens?: number }
    // `| undefined` stays: an app's run type declares it so under exactOptionalPropertyTypes.
    // eslint-disable-next-line sonarjs/no-redundant-optional
    readonly cost?: { readonly amountUsd?: number | undefined }
  }>
  cancel?(): unknown
}

/**
 * What `runAgentTurn` needs of an agent: `send`, nothing else. It has no `agentId` and no `dispose`;
 * whoever built the agent disposes it (`Symbol.asyncDispose` included). A `SdkAgentHandle` satisfies it.
 */
export interface AgentTurnAgent {
  send(message: AgentTurnMessage, options?: SdkSendOptions): Promise<AgentTurnRun>
}

/**
 * How a turn ended. `reason` is for logs; it is never meant for a client. A run the SDK reports as
 * cancelled (`cancelled: true`) is not a failure: the turn ran to the SDK's own end. `turn_cancelled`
 * is a turn this call cancelled, because its signal aborted.
 */
export type AgentTurnOutcome =
  | {
      ok: true
      cancelled?: true
      usage?: { inputTokens: number; outputTokens: number; costUsd?: number }
    }
  | { ok: false; code: 'turn_failed' | 'turn_cancelled'; reason: string }

export interface RunAgentTurnOptions {
  agent: AgentTurnAgent
  message: AgentTurnMessage
  runId: string
  emit: (event: AgentStreamEvent) => void
  signal?: AbortSignal
  /** Merged into `send`; `onDelta` and `signal` are set by `runAgentTurn`. */
  sendOptions?: SdkSendOptions
  /** Optional hook on each event before `emit`; return `undefined` to drop it. */
  mapEvent?: (event: AgentStreamEvent) => AgentStreamEvent | undefined
  /**
   * Values never to emit: every string in an event is masked, and text that could still grow into
   * one is held back and released as an extra `text_delta` before the next other event, or when the
   * turn ends (not when it is cancelled).
   */
  secrets?: readonly string[]
}

const ABORTED = Symbol('aborted')
type Aborted = typeof ABORTED

function ignore(): void {
  // a rejection nobody waits on
}

function failed(reason: string): AgentTurnOutcome {
  return { ok: false, code: 'turn_failed', reason }
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function finishedOutcome(
  result: Awaited<ReturnType<AgentTurnRun['wait']>>,
): Extract<AgentTurnOutcome, { ok: true }> {
  const input = finiteNumber(result.usage?.inputTokens)
  const output = finiteNumber(result.usage?.outputTokens)
  if (input === undefined && output === undefined) return { ok: true }
  const cost = finiteNumber(result.cost?.amountUsd)
  return {
    ok: true,
    usage: {
      inputTokens: input ?? 0,
      outputTokens: output ?? 0,
      ...(cost === undefined ? {} : { costUsd: cost }),
    },
  }
}

/** Resolves after `hops` microtask turns: a bound on waiting that never reaches a macrotask. */
async function microtasks(hops: number): Promise<void> {
  for (let i = 0; i < hops; i++) await Promise.resolve()
}

/** Cancel the run and close the iterator, waiting on neither past a few microtask turns. */
async function cancelRun(
  run: AgentTurnRun | undefined,
  iterator?: AsyncIterator<unknown>,
): Promise<AgentTurnOutcome> {
  const reasons: string[] = []
  const keep = (error: unknown): void => {
    reasons.push(describe(error))
  }
  const settling: Promise<void>[] = []
  if (run?.cancel !== undefined) {
    settling.push(
      Promise.resolve()
        .then(() => run.cancel?.())
        .then(ignore, keep),
    )
  }
  if (iterator?.return !== undefined) {
    settling.push(
      Promise.resolve()
        .then(() => iterator.return?.())
        .then(ignore, keep),
    )
  }
  await Promise.race([Promise.all(settling), microtasks(20)])
  return {
    ok: false,
    code: 'turn_cancelled',
    reason: ['the turn was cancelled', ...reasons].join('; '),
  }
}

function raceAbort<T>(
  work: Promise<T>,
  aborted: Promise<Aborted> | undefined,
): Promise<T | Aborted> {
  if (aborted === undefined) return work
  work.catch(ignore)
  return Promise.race([work, aborted])
}

/** The translator ignores raw `error` messages; a streamed error fails the turn all the same. */
function translateMessage(message: { readonly type: string }, runId: string): AgentStreamEvent[] {
  if (message.type === 'error') {
    const { code, message: text } = message as { code?: unknown; message?: unknown }
    return [
      {
        type: 'error',
        code: typeof code === 'string' ? code : 'error',
        message: typeof text === 'string' ? text : '',
        retryable: false,
      },
    ]
  }
  return translateSdkEvent(message as SdkMessage, runId)
}

interface TurnState {
  run?: AgentTurnRun
  iterator?: AsyncIterator<unknown>
  /** False from the moment the turn is cancelled or ends: nothing is emitted after that. */
  live: boolean
  mask?: AgentEventMask
}

/**
 * Run one turn of `message` on `agent`: deltas and stream messages are translated and passed to
 * `emit`; an aborted `signal` cancels the run and the stream. Never rejects, and never emits after
 * the signal aborted or after it returned.
 */
export async function runAgentTurn(options: RunAgentTurnOptions): Promise<AgentTurnOutcome> {
  const { signal } = options
  if (signal?.aborted === true) {
    return { ok: false, code: 'turn_cancelled', reason: 'the turn was cancelled before it started' }
  }
  const state: TurnState = { live: true }
  let onAbort: () => void = ignore
  const aborted = signal
    ? new Promise<Aborted>((resolve) => {
        onAbort = () => {
          // Synchronously, so a delta the SDK emits right after the abort is already dropped.
          state.live = false
          resolve(ABORTED)
        }
      })
    : undefined
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    return await runTurn(options, state, aborted)
  } catch (error) {
    const wasLive = state.live
    state.live = false
    if (!wasLive) return await cancelRun(state.run, state.iterator)
    state.live = wasLive
    state.mask?.flush()
    state.live = false
    const { iterator } = state
    if (iterator?.return !== undefined) {
      void Promise.resolve()
        .then(() => iterator.return?.())
        .catch(ignore)
    }
    return failed(describe(error))
  } finally {
    state.live = false
    signal?.removeEventListener('abort', onAbort)
  }
}

async function runTurn(
  options: RunAgentTurnOptions,
  state: TurnState,
  aborted: Promise<Aborted> | undefined,
): Promise<AgentTurnOutcome> {
  const isLive = (): boolean => state.live
  if (options.secrets !== undefined && options.secrets.length > 0) {
    state.mask = createAgentEventMask(options.secrets, (event) => {
      if (state.live) options.emit(event)
    })
  }
  let textStreamed = false as boolean
  let streamedError: string | undefined
  const send = (event: AgentStreamEvent): void => {
    if (!state.live) return
    const mapped = options.mapEvent === undefined ? event : options.mapEvent(event)
    // `mapEvent` may itself have aborted the signal: recheck before emitting.
    if (mapped === undefined || !isLive()) return
    if (state.mask === undefined) options.emit(mapped)
    else state.mask.emit(mapped)
  }
  const onDelta = ({ update }: { update: { type: string } }): void => {
    if (!state.live) return
    if (update.type !== 'text-delta' && update.type !== 'thinking-delta') return
    for (const event of translateInteractionUpdate(
      update as Parameters<typeof translateInteractionUpdate>[0],
    )) {
      if (event.type === 'text_delta') textStreamed = true
      send(event)
    }
  }
  const sending = options.agent.send(options.message, {
    ...options.sendOptions,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    onDelta,
  })
  const sent = await raceAbort(sending, aborted)
  if (sent === ABORTED) {
    // A run that appears after the abort is cancelled too.
    void sending.then(
      (late) =>
        void Promise.resolve()
          .then(() => late.cancel?.())
          .catch(ignore),
      ignore,
    )
    return cancelRun(undefined)
  }
  const run = sent
  state.run = run
  if (!isLive()) return cancelRun(run)

  if (run.stream !== undefined) {
    const iterator = run.stream()[Symbol.asyncIterator]()
    state.iterator = iterator
    for (;;) {
      const step = await raceAbort(iterator.next(), aborted)
      if (step === ABORTED || !isLive()) return cancelRun(run, iterator)
      if (step.done === true) break
      const message = step.value as { type?: unknown } | null
      if (typeof message !== 'object' || message === null || typeof message.type !== 'string') {
        continue
      }
      const typed = message as { readonly type: string }
      const isAssistant = message.type === 'assistant'
      // The step's finished `assistant` message repeats text its deltas already sent.
      const skipText = isAssistant && textStreamed
      if (isAssistant) textStreamed = false
      for (const event of translateMessage(typed, options.runId)) {
        if (skipText && event.type === 'text_delta') continue
        if (event.type === 'error')
          streamedError ??= describeStreamedError(
            typeof (event as { code?: unknown }).code === 'string'
              ? event
              : { ...event, code: undefined },
          )
        send(event)
      }
    }
  }
  const result = await raceAbort(run.wait(), aborted)
  if (result === ABORTED || !isLive()) return cancelRun(run)
  state.mask?.flush()
  if (streamedError !== undefined) return failed(`the run streamed an error (${streamedError})`)
  if (result.status === 'cancelled') return { ...finishedOutcome(result), cancelled: true }
  if (result.status === 'error') {
    const detail = result.error === undefined ? '' : `: ${result.error.message}`
    return failed(`the run ended with status error${detail}`)
  }
  return finishedOutcome(result)
}

export interface CompleteFromTurnOptions {
  /**
   * A run the SDK ends as cancelled: `'throw'` (default) fails the request, `'complete'` returns the
   * text streamed so far.
   */
  onCancelled?: 'throw' | 'complete'
  /** Called with the reason of a failed turn (or `the run ended with status cancelled`), before it throws. */
  onFailure?: (reason: string) => void
}

/**
 * The `complete` port of `createOpenAICompatibleRoutes` over one turn per request: the transcript
 * is the message, the `text_delta` text joined is the reply. A failed turn throws, which the route
 * answers with 502; so does a cancelled one unless `onCancelled` is `'complete'`.
 */
export function completeFromTurn<A extends AgentTurnAgent = SdkAgentHandle<SdkMessage>>(
  withAgent: <R>(work: (agent: A) => Promise<R>) => Promise<R>,
  options: CompleteFromTurnOptions = {},
): OpenAICompatibleRoutesOptions['complete'] {
  return async (
    request: OpenAIChatRequest,
    onDelta?: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<OpenAICompletion> => {
    const text: string[] = []
    const outcome = await withAgent((agent) =>
      runAgentTurn({
        agent,
        message: renderTranscript(request.messages),
        runId: globalThis.crypto.randomUUID(),
        emit: (event) => {
          if (event.type === 'text_delta' && typeof event.content === 'string') {
            text.push(event.content)
            onDelta?.(event.content)
          }
        },
        ...(signal === undefined ? {} : { signal }),
      }),
    )
    if (!outcome.ok) {
      options.onFailure?.(outcome.reason)
      throw new Error(outcome.reason)
    }
    if (outcome.cancelled === true && options.onCancelled !== 'complete') {
      const reason = 'the run ended with status cancelled'
      options.onFailure?.(reason)
      throw new Error(reason)
    }
    const usage = outcome.usage
    return {
      text: text.join(''),
      ...(usage === undefined
        ? {}
        : { usage: { promptTokens: usage.inputTokens, completionTokens: usage.outputTokens } }),
    }
  }
}
