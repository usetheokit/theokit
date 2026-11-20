/**
 * A `DelegationPort` that runs a fresh agent per task: the factory builds the agent, the port sends
 * the task, drains the stream, cancels the run when the delegating signal aborts, and disposes the
 * agent in every case.
 */
import { GuardrailError } from '../guardrails/types.js'

import { DelegationTimeoutError } from './delegation-lifecycle.js'
import type { DelegationPort } from './delegation-scoring.js'
import {
  DelegationBudgetExceededError,
  DelegationError,
  type DelegationResult,
} from './delegation-types.js'
import type { SdkMessage } from './event-translator.js'
import type { SdkAgentHandle, SdkSendOptions, SdkTurnHandle } from './sdk-adapter.js'

export interface DelegationPortFromAgentFactoryOptions {
  /** Options for every `send`. The delegating signal, when there is one, replaces `signal` here. */
  readonly sendOptions?: SdkSendOptions
}

const WORKER_NAME = 'worker'

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function describeStreamedError(event: object): string {
  const { code, message } = event as { code?: unknown; message?: unknown }
  const text = typeof code === 'string' || typeof code === 'number' ? String(code) : 'error'
  return typeof message === 'string' && message !== '' ? `${text}: ${message}` : text
}

/** Drain the run's stream and return a description of the first error event, if any. */
async function streamedErrorOf(run: SdkTurnHandle<SdkMessage>): Promise<string | undefined> {
  if (run.stream === undefined) return undefined
  let streamed: string | undefined
  for await (const message of run.stream()) {
    const event: { type?: unknown; status?: unknown; message?: unknown } = message
    if (event.type === 'error') streamed ??= describeStreamedError(message)
    // A guarded agent's stream ends a failed run with `{ type: 'status', status: 'ERROR', message }`.
    else if (event.type === 'status' && event.status === 'ERROR') {
      streamed ??= describeStreamedError({ code: 'ERROR', message: event.message })
    }
  }
  return streamed
}

type Settled = Awaited<ReturnType<SdkTurnHandle<SdkMessage>['wait']>> & {
  readonly streamed: string | undefined
}

/**
 * The run's outcome, its stream drained first. An abort of `signal` cancels the run; a failing
 * cancellation rejects rather than being lost, and its handler is attached at once so it is never an
 * unhandled rejection.
 */
async function untilSettled(
  run: SdkTurnHandle<SdkMessage>,
  signal: AbortSignal | undefined,
): Promise<Settled> {
  let cancelling: Promise<{ readonly failure: unknown } | undefined> | undefined
  const cancel = (): void => {
    cancelling ??= (async () => {
      const cancelRun = (run as { cancel?: () => Promise<unknown> }).cancel
      if (typeof cancelRun !== 'function') throw new Error('the worker run cannot be cancelled')
      await cancelRun.call(run)
    })().then(
      () => undefined,
      (failure: unknown) => ({ failure }),
    )
  }
  if (signal?.aborted === true) cancel()
  else signal?.addEventListener('abort', cancel, { once: true })
  let result: Settled
  try {
    const streamed = await streamedErrorOf(run)
    result = { ...(await run.wait()), streamed }
  } catch (error) {
    const cancelled = await cancelling
    if (cancelled === undefined) throw error
    throw new AggregateError(
      [error, cancelled.failure],
      `${describeError(error)}; cancelling the worker's run then failed: ${describeError(cancelled.failure)}`,
    )
  } finally {
    signal?.removeEventListener('abort', cancel)
  }
  const cancelled = await cancelling
  if (cancelled !== undefined) throw cancelled.failure
  return result
}

/** Whether a guardrail error sits anywhere in `error`, an aggregate of aggregates included. */
function carriesGuardrailError(error: unknown): boolean {
  if (error instanceof GuardrailError) return true
  return error instanceof AggregateError && error.errors.some(carriesGuardrailError)
}

/** Failures that must reach the caller as themselves: a guard's trigger text must not be wrapped. */
function passesThrough(error: unknown): boolean {
  if (error instanceof AggregateError) return carriesGuardrailError(error)
  return (
    error instanceof GuardrailError ||
    error instanceof DelegationError ||
    error instanceof DelegationBudgetExceededError ||
    error instanceof DelegationTimeoutError
  )
}

async function runOnce(
  create: () => Promise<SdkAgentHandle<SdkMessage>>,
  task: string,
  signal: AbortSignal | undefined,
  sendOptions: SdkSendOptions | undefined,
): Promise<DelegationResult> {
  if (signal?.aborted === true)
    throw new Error('the delegating run was cancelled before the worker started')
  const agent = await create()
  let outcome: DelegationResult
  try {
    const run = await agent.send(task, {
      ...sendOptions,
      ...(signal === undefined ? {} : { signal }),
    })
    const { streamed, ...result } = await untilSettled(run, signal)
    if (streamed !== undefined) throw new Error(`the worker's run streamed an error (${streamed})`)
    if (result.status !== 'finished')
      throw new Error(`the worker's run ended with status ${String(result.status)}`)
    // The SDK accounts the worker's cost; this port reports none it measured.
    outcome = {
      response: result.result ?? '',
      toolCalls: [],
      cost: 0,
      costUnknown: true,
      tokens: 0,
    }
  } catch (error) {
    // The disposal still runs; if it fails too, both failures are reported, the run's first.
    try {
      await agent.dispose()
    } catch (disposal) {
      throw new AggregateError(
        [error, disposal],
        `${describeError(error)}; disposing the worker then failed: ${describeError(disposal)}`,
      )
    }
    throw error
  }
  await agent.dispose()
  return outcome
}

/**
 * A `DelegationPort` that builds a fresh agent with `create` for every task, runs one turn and
 * disposes the agent. A failure is a `DelegationError`, except guardrail and delegation errors (and
 * aggregates carrying a guardrail error), which pass through unchanged.
 */
export function delegationPortFromAgentFactory(
  create: () => Promise<SdkAgentHandle<SdkMessage>>,
  options?: DelegationPortFromAgentFactoryOptions,
): DelegationPort {
  return {
    run: async (message, runOptions): Promise<DelegationResult> => {
      const signal = runOptions?.signal ?? options?.sendOptions?.signal
      try {
        return await runOnce(create, message, signal, options?.sendOptions)
      } catch (error) {
        throw passesThrough(error) ? error : new DelegationError(WORKER_NAME, error)
      }
    },
  }
}
