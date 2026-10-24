import { channelRendering } from '@theokit/gateway'
import type { GatewayContext, GatewayHandler, MessageEvent, SendResult } from '@theokit/gateway'
import { ChatPresenter, fromSdkMessage } from '@theokit/presenter'
import type { AgentOutputEvent, ChatMessage } from '@theokit/presenter'

import type { TurnAgent } from '../agent-port.js'

/** The reply to a turn that produced no visible answer (D8): reasoning only, tools only, nothing. */
export const NO_ANSWER_REPLY = 'I could not come up with an answer to that.'

export type { TurnAgent, TurnRun } from '../agent-port.js'

export interface ReplyHandlerOptions {
  /** One request boundary per message; the composition root's `withAgent`. */
  readonly withAgent: <R>(work: (agent: TurnAgent) => R | Promise<R>) => Promise<R>
}

/** A turn whose run resolved with `status: "error"`, which the SDK reports without rejecting. */
export class AgentTurnError extends Error {
  constructor(
    readonly platform: string,
    readonly code: string | undefined,
  ) {
    super(`${platform}: agent turn failed (${code ?? 'no error code'})`)
    this.name = 'AgentTurnError'
  }
}

/** A reply the platform refused. Carries the code, never the message text. */
export class ReplyDeliveryError extends Error {
  constructor(
    readonly platform: string,
    readonly code: string,
    options?: { readonly cause?: unknown },
  ) {
    super(`${platform}: reply was not delivered (${code})`, options)
    this.name = 'ReplyDeliveryError'
  }
}

const AGENT_ERROR: AgentOutputEvent = { type: 'error', message: 'agent turn failed', code: 'AGENT_ERROR' }
const FINISH: AgentOutputEvent = { type: 'finish', reason: 'end_turn' }

/**
 * A presenter in the platform's own rendering: `channelRendering` pairs the dialect rewrite with
 * the format the adapter is told, where `toDialect` alone would leave the presenter's default
 * `markdown` on platforms that show it raw.
 */
function presenterFor(event: MessageEvent): ChatPresenter {
  return new ChatPresenter({ channel: event.channel, ...channelRendering(event.platform) })
}

/** Present one synthetic `finish` (D8) and return the single reply the turn sends. */
function finishTurn(presenter: ChatPresenter): Pick<ChatMessage, 'text' | 'format'> {
  const [message] = presenter.present(FINISH)
  return message ?? { text: NO_ANSWER_REPLY, format: 'plain' }
}

/**
 * Send the turn's one reply. When the turn already failed, a reply that also fails keeps the turn's
 * error as its cause, so the runner's `on_error` sees why the person was answered at all.
 */
async function send(
  ctx: GatewayContext,
  reply: Pick<ChatMessage, 'text' | 'format'>,
  turnFailure: TurnOutcome,
): Promise<void> {
  const cause = turnFailure.failed ? { cause: turnFailure.error } : undefined
  let result: SendResult
  try {
    result = await ctx.reply(reply.text, { ...(reply.format ? { format: reply.format } : {}) })
  } catch (error) {
    if (cause === undefined) throw error
    throw new AggregateError(
      [cause.cause, error],
      `${ctx.event.platform}: the turn failed and its reply could not be sent`,
    )
  }
  if (!result.ok) throw new ReplyDeliveryError(ctx.event.platform, result.error?.code ?? 'unknown', cause)
}

type TurnOutcome = { readonly failed: false } | { readonly failed: true; readonly error: unknown }

/** Stream the agent's answer into the presenter; a failure is returned, not thrown. */
async function streamTurn(
  agent: TurnAgent,
  event: MessageEvent,
  presenter: ChatPresenter,
): Promise<TurnOutcome> {
  // An ERROR or EXPIRED status in the stream fails the turn even when `wait()` reports it finished.
  let streamedError: string | undefined
  try {
    const run = await agent.send(event.text)
    for await (const frame of run.stream()) {
      // The spread gives the frame an anonymous type, which the presenter's index signature
      // accepts. A streamed `finish` is dropped: it would emit and reset the presenter before the
      // one synthetic finish the reply is taken from (D8).
      for (const output of fromSdkMessage({ ...frame })) {
        if (output.type === 'error') streamedError = output.code
        if (output.type !== 'finish') presenter.present(output)
      }
    }
    const result = await run.wait()
    if (result.status !== 'error' && streamedError === undefined) return { failed: false }
    presenter.present(AGENT_ERROR)
    return { failed: true, error: new AgentTurnError(event.platform, result.error?.code ?? streamedError) }
  } catch (error) {
    presenter.present(AGENT_ERROR)
    return { failed: true, error }
  }
}

/**
 * Run one turn and close the agent once. A `close()` that throws becomes the turn's failure only
 * when the turn itself succeeded, so it never hides the error the person was answered for.
 */
async function runTurn(
  agent: TurnAgent,
  event: MessageEvent,
  presenter: ChatPresenter,
): Promise<TurnOutcome> {
  const outcome = await streamTurn(agent, event, presenter)
  try {
    agent.close?.()
  } catch (error) {
    if (!outcome.failed) return { failed: true, error }
  }
  return outcome
}

/**
 * The handler every runner uses: one agent turn per message with text, and exactly one reply per
 * turn (FR-004, D8). A failed turn still replies, then rethrows so the runner fires `on_error`.
 */
export function createReplyHandler(options: ReplyHandlerOptions): GatewayHandler {
  return async (event, ctx) => {
    if (event.text.trim() === '') return
    const presenter = presenterFor(event)
    let started = false
    try {
      await options.withAgent(async (agent) => {
        started = true
        const outcome = await runTurn(agent, event, presenter)
        await send(ctx, finishTurn(presenter), outcome)
        if (outcome.failed) throw outcome.error
      })
    } catch (error) {
      // After the callback ran, the turn already replied; this is the boundary's own failure.
      if (started) throw error
      // The agent factory rejected before the turn began: the person still gets one reply.
      presenter.present(AGENT_ERROR)
      await send(ctx, finishTurn(presenter), { failed: true, error })
      throw error
    }
  }
}
