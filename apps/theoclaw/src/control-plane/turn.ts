import { randomUUID } from 'node:crypto'

import { type AgentStreamEvent, runAgentTurn } from '@theokit/agents/bridge'
import { maskSecrets } from '@theokit/gateway'

import type { TurnAgent, TurnRun } from '../agent-port.js'
import { type TurnUsage, usageOf } from '../usage/turn-usage.js'
import { describeError } from './errors.js'

export type { TurnAgent, TurnRun } from '../agent-port.js'

/** One event of a turn: the bridge's typed `AgentStreamEvent`. */
export type TurnEvent = AgentStreamEvent

/**
 * How a turn ended. `reason` says why a failed or cancelled one ended, for stderr; it is never sent
 * to a client. `turn_cancelled` comes only from a turn given a signal, which the `/control` socket
 * never passes.
 */
export type TurnOutcome =
  | { readonly ok: true; readonly usage?: TurnUsage }
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
  /** Values no event may carry (`processSecrets`, B-398 FR-007). Default: none. */
  readonly secrets?: readonly string[]
  /** The model the agents run (`THEOCLAW_MODEL`); a finished turn's outcome carries its usage only with it. */
  readonly model?: string
}

/** A turn for one chat message: the message, where each translated event goes, and what cancels it. */
export type TurnRunner = (
  message: string,
  emit: (event: TurnEvent) => void,
  signal?: AbortSignal,
) => Promise<TurnOutcome>

function failed(reason: string): TurnOutcome {
  return { ok: false, code: 'turn_failed', reason }
}

/** A streamed error as the turn's reason shows it: its code, and the message when it has one. */
export function describeStreamedError(event: {
  readonly type: string
  readonly code?: unknown
  readonly message?: unknown
}): string {
  const { code, message } = event
  const text = String(code ?? 'error')
  return typeof message === 'string' && message !== '' ? `${text}: ${message}` : text
}

/**
 * How a run ended, from its final status and the code of the first error it streamed: a streamed
 * error fails the turn even when `wait()` reports it finished. Shared by the sessionless turn and
 * the session turn (`session-turn.ts`).
 */
export function outcomeOf(
  result: Awaited<ReturnType<TurnRun['wait']>>,
  streamedError: string | undefined,
  model?: string,
): TurnOutcome {
  if (streamedError !== undefined) return failed(`the run streamed an error (${streamedError})`)
  if (result.status === 'error') return failed('the run ended with status error')
  return model === undefined ? { ok: true } : { ok: true, usage: usageOf(result, model) }
}

async function runWith(agent: TurnAgent, options: TurnOptions): Promise<TurnOutcome> {
  const outcome = await runAgentTurn({
    agent,
    message: options.message,
    runId: options.runId,
    emit: options.emit,
    ...(options.secrets === undefined ? {} : { secrets: options.secrets }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
  // `runAgentTurn` masks and flushes: a cancelled turn emits nothing more.
  if (!outcome.ok) return outcome
  // An SDK run that ended as `cancelled` is not a failure here, as it never was.
  if (options.model === undefined) return { ok: true }
  // No token count reported: the outcome has no usage, and the record is zeros, as it always was.
  const { inputTokens = 0, outputTokens = 0, costUsd } = outcome.usage ?? {}
  const base = { inputTokens, outputTokens, model: options.model }
  return { ok: true, usage: costUsd === undefined ? { ...base, costUnpriced: true } : { ...base, costUsd } }
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
  const secrets = options.secrets ?? []
  // The model id reaches a frame and a log line; a configured value inside it is masked there too.
  const model = options.model === undefined ? {} : { model: maskSecrets(options.model, secrets) }
  let outcome: TurnOutcome
  try {
    outcome = await options.withAgent((agent) =>
      runWith(agent, { ...options, ...model, secrets }),
    )
  } catch (error) {
    outcome = failed(describeError(error))
  }
  // WebChat sends a failed turn's reason to the client, and an SDK error may echo a key.
  return outcome.ok ? outcome : { ...outcome, reason: maskSecrets(outcome.reason, secrets) }
}

/**
 * The runner the control socket and WebChat call: one fresh run id per turn. With `model`, a
 * finished turn's outcome carries its usage record (B-400 FR-003).
 */
export function createTurnRunner(
  withAgent: WithAgent,
  secrets: readonly string[] = [],
  model?: string,
): TurnRunner {
  return (message, emit, signal) =>
    runTheoClawTurn({
      withAgent,
      message,
      runId: randomUUID(),
      emit,
      secrets,
      ...(signal === undefined ? {} : { signal }),
      ...(model === undefined ? {} : { model }),
    })
}
