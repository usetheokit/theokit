import { randomUUID } from 'node:crypto'

import { type SdkMessage, translateSdkEvent } from '@theokit/agents/bridge'

import { describeError } from './errors.js'

/**
 * What a turn needs of an agent. The stream element is the narrow `{ type }`: the bridge's
 * `SdkMessage` declares an index signature the SDK's message interfaces do not, so the SDK agent
 * would not be assignable to a port typed with it.
 *
 * There is no `close` here on purpose. The request boundary (`createContainer().withAgent`) disposes
 * the agent through `Symbol.asyncDispose` when the turn ends. In `@theokit/sdk` 5.11 `close()` only
 * marks the agent disposed, so calling it first makes that disposal return without tearing the
 * session down.
 */
export interface TurnAgent {
  send(text: string): Promise<TurnRun>
}

export interface TurnRun {
  stream(): AsyncIterable<{ readonly type: string }>
  wait(): Promise<{ readonly status: string }>
}

/** One event as `translateSdkEvent` returns it. */
export type TurnEvent = ReturnType<typeof translateSdkEvent>[number]

/** How a turn ended. `reason` says why a failed one failed, for stderr; it is never sent to a client. */
export type TurnOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: 'turn_failed'; readonly reason: string }

/** Runs `work` with one agent of its own request, as `createContainer().withAgent` does. */
export type WithAgent = <R>(work: (agent: TurnAgent) => Promise<R>) => Promise<R>

export interface TurnOptions {
  readonly withAgent: WithAgent
  readonly message: string
  readonly runId: string
  readonly emit: (event: TurnEvent) => void
}

/** A turn for one chat frame: the message, and where each translated event goes. */
export type TurnRunner = (message: string, emit: (event: TurnEvent) => void) => Promise<TurnOutcome>

function failed(reason: string): TurnOutcome {
  return { ok: false, code: 'turn_failed', reason }
}

/** Emit every translated event of the run; the code of the first streamed error, if any. */
async function streamRun(run: TurnRun, options: TurnOptions): Promise<string | undefined> {
  let streamedError: string | undefined
  for await (const message of run.stream()) {
    for (const event of translateSdkEvent(message as SdkMessage, options.runId)) {
      if (event.type === 'error') streamedError ??= String(event.code)
      options.emit(event)
    }
  }
  return streamedError
}

async function runWith(agent: TurnAgent, options: TurnOptions): Promise<TurnOutcome> {
  const run = await agent.send(options.message)
  const streamedError = await streamRun(run, options)
  const result = await run.wait()
  if (streamedError !== undefined) return failed(`the run streamed an error (${streamedError})`)
  return result.status === 'error' ? failed('the run ended with status error') : { ok: true }
}

/**
 * One turn: one agent built inside `withAgent`, one `send`, every SDK message translated and
 * emitted. A translated `done` or `error` is data inside the turn, never its end: the outcome is
 * what the caller turns into the one final frame. A streamed error fails the turn even when `wait()`
 * reports it finished, as B-369's reply handler does. The turn never throws: a failure anywhere,
 * building or disposing the agent included, is a `turn_failed` outcome carrying its reason. A
 * disposal that throws fails the turn, finished or not: the agent's state is then unknown.
 */
export async function runTheoClawTurn(options: TurnOptions): Promise<TurnOutcome> {
  try {
    return await options.withAgent((agent) => runWith(agent, options))
  } catch (error) {
    return failed(describeError(error))
  }
}

/** The runner the control socket calls: one fresh run id per turn. */
export function createTurnRunner(withAgent: WithAgent): TurnRunner {
  return (message, emit) => runTheoClawTurn({ withAgent, message, runId: randomUUID(), emit })
}
