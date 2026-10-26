import { channelRendering } from '@theokit/gateway'
import type { BasePlatformAdapter, GatewayContext, GatewayHandler, MessageEvent, PlatformName, SendResult } from '@theokit/gateway'
import { ChatPresenter, fromSdkMessage } from '@theokit/presenter'
import type { AgentOutputEvent, ChatMessage } from '@theokit/presenter'

import type { TurnAgent } from '../agent-port.js'
import type { BroadcastGroup, BroadcastGroups } from './broadcast-groups.js'
import type { SessionLease } from '../sessions/session-agents.js'

/** The reply to a turn that produced no visible answer (D8): reasoning only, tools only, nothing. */
export const NO_ANSWER_REPLY = 'I could not come up with an answer to that.'

/** The one line `/new` and `/reset` answer with. */
export const NEW_CONVERSATION_REPLY = 'Started a new conversation.'

/** The one line a `/new` or `/reset` that could not be saved answers with. */
export const RESET_FAILED_REPLY = 'I could not start a new conversation; this one goes on.'

/**
 * Matched on the whole trimmed text, here rather than through the runner's command registry, whose
 * word-boundary match would also reset on `/new chat` (FR-008); and the reset needs the session,
 * which this handler already holds.
 */
const RESET_COMMANDS: ReadonlySet<string> = new Set(['/new', '/reset'])

export type { TurnAgent, TurnRun } from '../agent-port.js'

/** Broadcast groups and how their other members are reached (OC-21). */
export interface BroadcastOptions {
  readonly groups: BroadcastGroups
  /** The started adapter of a platform, or undefined while it is not started. */
  readonly adapterFor: (platform: string) => BasePlatformAdapter | undefined
  /** Where a member that could not be reached is reported; never with a token or a sender id. */
  readonly write: (line: string) => void
}

export interface ReplyHandlerOptions {
  /**
   * One request boundary per message, holding a lease on the agent of the message's session; the
   * composition root's chat `withAgent`.
   */
  readonly withAgent: <R>(event: MessageEvent, work: (lease: SessionLease) => R | Promise<R>) => Promise<R>
  /** Start the event's session afresh; `SessionAgents.reset`. */
  readonly reset: (event: MessageEvent) => Promise<void>
  /** Without it, every channel is its own conversation. */
  readonly broadcast?: BroadcastOptions
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
 * `markdown` on platforms that show it raw. Decided in ADR 0031, which amends the plan's D12.
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

type TurnOutcome =
  | { readonly failed: false; readonly answer: string }
  | { readonly failed: true; readonly error: unknown }

/** What a turn's stream left behind: its plain answer and the error code it streamed, if any. */
interface StreamedTurn {
  answer: string
  error: string | undefined
}

/**
 * Present one frame's events. The spread gives the frame an anonymous type, which the presenter's
 * index signature accepts. A streamed `finish` is dropped: it would emit and reset the presenter
 * before the one synthetic finish the reply is taken from (D8).
 */
function presentFrame(frame: { readonly type: string }, presenter: ChatPresenter, streamed: StreamedTurn): void {
  for (const output of fromSdkMessage({ ...frame })) {
    if (output.type === 'error') streamed.error = output.code
    // The answer before any platform rendering, for a broadcast group's thread and its other members.
    if (output.type === 'text') streamed.answer += output.text
    if (output.type !== 'finish') presenter.present(output)
  }
}

/** Stream the agent's answer into the presenter; a failure is returned, not thrown. */
async function streamTurn(
  agent: TurnAgent,
  event: MessageEvent,
  prompt: string,
  presenter: ChatPresenter,
): Promise<TurnOutcome> {
  // An ERROR or EXPIRED status in the stream fails the turn even when `wait()` reports it finished.
  const streamed: StreamedTurn = { answer: '', error: undefined }
  try {
    const run = await agent.send(prompt)
    for await (const frame of run.stream()) presentFrame(frame, presenter, streamed)
    const result = await run.wait()
    if (result.status !== 'error' && streamed.error === undefined) {
      return { failed: false, answer: streamed.answer === '' ? NO_ANSWER_REPLY : streamed.answer }
    }
    presenter.present(AGENT_ERROR)
    return { failed: true, error: new AgentTurnError(event.platform, result.error?.code ?? streamed.error) }
  } catch (error) {
    presenter.present(AGENT_ERROR)
    return { failed: true, error }
  }
}

/**
 * One agent turn on `prompt`, and exactly one reply to the origin (FR-004, D8). A failed turn still
 * replies, then rethrows so the runner fires `on_error`. Resolves the answer of a turn that succeeded.
 * The agent is the session's, owned by `SessionAgents`; the lease is released once the turn has
 * replied, failed or not.
 */
async function answerTurn(options: ReplyHandlerOptions, event: MessageEvent, ctx: GatewayContext, prompt: string): Promise<string> {
  const presenter = presenterFor(event)
  let started = false
  try {
    return await options.withAgent(event, async (lease) => {
      started = true
      try {
        const outcome = await streamTurn(lease.agent, event, prompt, presenter)
        await send(ctx, finishTurn(presenter), outcome)
        if (outcome.failed) throw outcome.error
        return outcome.answer
      } finally {
        lease.release()
      }
    })
  } catch (error) {
    // After the callback ran, the turn already replied; this is the boundary's own failure.
    if (started) throw error
    // The session's agent could not be resolved before the turn began: the person still gets one reply.
    presenter.present(AGENT_ERROR)
    await send(ctx, finishTurn(presenter), { failed: true, error })
    throw error
  }
}

/** Why one member could not be reached; a code or an error name, never the message or an id. */
async function sendToMember(adapter: BasePlatformAdapter | undefined, channelId: string, platform: string, answer: string): Promise<string | undefined> {
  if (adapter === undefined) return 'not started'
  // Rendered for the member's own platform, not the origin's dialect.
  const presenter = new ChatPresenter({ channel: { id: channelId, type: 'group' }, ...channelRendering(platform as PlatformName) })
  presenter.present({ type: 'text', text: answer })
  const reply = finishTurn(presenter)
  try {
    const result = await adapter.sendMessage({
      channel: { id: channelId, type: 'group' },
      text: reply.text,
      ...(reply.format ? { format: reply.format } : {}),
    })
    return result.ok ? undefined : (result.error?.code ?? 'refused')
  } catch (error) {
    return error instanceof Error ? error.name : 'thrown'
  }
}

/** Send the answer to every other member, each on its own: one that fails costs only itself. */
async function fanOut(broadcast: BroadcastOptions, group: BroadcastGroup, event: MessageEvent, answer: string): Promise<void> {
  const others = group.members.filter((member) => member.platform !== event.platform || member.channelId !== event.channel.id)
  await Promise.all(
    others.map(async ({ platform, channelId }) => {
      const failure = await sendToMember(broadcast.adapterFor(platform), channelId, platform, answer)
      if (failure !== undefined) broadcast.write(`broadcast group ${group.name}: ${platform}: the answer was not delivered (${failure})`)
    }),
  )
}

/**
 * The handler every runner uses: one agent turn per message with text, on the agent of the
 * message's session. In a broadcast group's member channel the turn carries the group's thread,
 * runs after the group's earlier turns, and its answer also reaches every other member; the
 * exchange joins the thread only once the origin was answered. The agent is never closed or
 * disposed here: it is the session's, owned by `SessionAgents`.
 */
export function createReplyHandler(options: ReplyHandlerOptions): GatewayHandler {
  return async (event, ctx) => {
    const text = event.text.trim()
    if (text === '') return
    if (RESET_COMMANDS.has(text)) {
      // No lease and no model turn: a session whose agent cannot be resolved can still be reset.
      // A reset that could not be saved moved nothing; the person is told, and the runner too.
      try {
        await options.reset(event)
      } catch (error) {
        await send(ctx, { text: RESET_FAILED_REPLY, format: 'plain' }, { failed: true, error })
        throw error
      }
      await send(ctx, { text: NEW_CONVERSATION_REPLY, format: 'plain' }, { failed: false, answer: NEW_CONVERSATION_REPLY })
      return
    }
    const broadcast = options.broadcast
    const group = broadcast?.groups.groupOf(event.platform, event.channel.id)
    if (broadcast === undefined || group === undefined) {
      await answerTurn(options, event, ctx, event.text)
      return
    }
    // Entered before any await, so the group's turns run in delivery order.
    await group.run(async () => {
      const answer = await answerTurn(options, event, ctx, group.prompt(event.text))
      group.record(event.platform, event.text, answer)
      await fanOut(broadcast, group, event, answer)
    })
  }
}
