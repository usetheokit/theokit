import { channelRendering } from '@theokit/gateway'
import type {
  BasePlatformAdapter,
  GatewayContext,
  GatewayHandler,
  MessageEvent,
  PlatformName,
  SendResult,
} from '@theokit/gateway'
import { ChatPresenter, fromSdkMessage } from '@theokit/presenter'
import type { AgentOutputEvent, ChatMessage } from '@theokit/presenter'

import type { TurnAgent, TurnRun } from '../agent-port.js'
import { untrustedContentSendOptions } from '../agent/untrusted-content.js'
import { maskSecrets } from './channel-loop.js'
import { createStreamMask } from './stream-mask.js'
import type { StreamMask } from './stream-mask.js'
import type { BroadcastGroup, BroadcastGroups } from './broadcast-groups.js'
import { type DisplayConfig, resolveDisplay } from './display-config.js'
import { createProgressGate, type ProgressGate } from './progress.js'
import { compactIfNeeded } from './compact-command.js'
import { deliverText } from './deliver.js'
import { type GoalSettings, GOAL_USAGE_REPLY, goalOf, runGoal } from './goal-command.js'
import type { SessionLease } from '../sessions/session-agents.js'
import { formatUsageFooter, formatUsageLine, type TurnUsage, usageOf } from '../usage/turn-usage.js'
import type { UsageMode } from './usage-hook.js'
import { THINKING_LEVELS, type ThinkingLevel } from '../agent/failover.js'
import { type CompactSettings, compactOf, runCompact } from './compact-command.js'
import { showTyping, type TypingOptions } from './typing.js'

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

const THINK_COMMAND = /^\/think(?:\s+(\S+))?$/i

function answerThink(
  think: (event: MessageEvent, level: ThinkingLevel) => void,
  event: MessageEvent,
  arg: string | undefined,
): string {
  const level = arg?.toLowerCase()
  if (level === undefined || !(THINKING_LEVELS as readonly string[]).includes(level))
    return `Usage: /think ${THINKING_LEVELS.join('|')}`
  think(event, level as ThinkingLevel)
  return `Thinking level set to ${level}.`
}

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
  readonly withAgent: <R>(
    event: MessageEvent,
    work: (lease: SessionLease) => R | Promise<R>,
  ) => Promise<R>
  /** Start the event's session afresh; `SessionAgents.reset`. */
  readonly reset: (event: MessageEvent) => Promise<void>
  /** `/think <level>`: set the session's thinking level; without it, `/think` is an ordinary message. */
  readonly think?: (event: MessageEvent, level: ThinkingLevel) => void
  /** Without it, every channel is its own conversation. */
  readonly broadcast?: BroadcastOptions
  /**
   * Values no reply may carry (`processSecrets`, B-398 FR-006): masked in the origin's reply and in
   * the answer a broadcast group's other members and thread receive. Default: none.
   */
  readonly secrets?: readonly string[]
  /** What `/goal` runs with (B-397 FR-008); without it, `/goal` is an ordinary message. */
  readonly goal?: GoalSettings
  /** Per-platform display overrides (B-370); without them each platform keeps its tier's defaults. */
  readonly display?: DisplayConfig
  /** `THEOCLAW_INCOGNITO=on`: progress lines carry no tool input, status detail or reasoning. */
  readonly incognito?: boolean
  /** A finished turn's usage: its line, and the footer its conversation's `/usage` asks for (FR-005). */
  readonly usage?: ReplyUsageOptions
  /** `/compact` and the `THEOCLAW_COMPACT_AT` threshold (OC-53); without it, `/compact` is an ordinary message. */
  readonly compact?: CompactSettings
  /** A typing indicator shown while a turn or goal runs (OC-106); without it, none. */
  readonly typing?: TypingOptions
}

export interface ReplyUsageOptions {
  /** The conversation's `/usage` mode, read when the reply is sent (EC-7). */
  readonly modeFor: (event: MessageEvent) => UsageMode
  /** The model the chat agents run (`THEOCLAW_MODEL`). */
  readonly model: string
  /** Where the usage line goes; the masked write. */
  readonly write: (line: string) => void
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

const AGENT_ERROR: AgentOutputEvent = {
  type: 'error',
  message: 'agent turn failed',
  code: 'AGENT_ERROR',
}
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
  if (!result.ok)
    throw new ReplyDeliveryError(ctx.event.platform, result.error?.code ?? 'unknown', cause)
}

type TurnOutcome =
  | {
      readonly failed: false
      readonly answer: string
      readonly result?: Awaited<ReturnType<TurnRun['wait']>>
    }
  | { readonly failed: true; readonly error: unknown }

/**
 * What a turn's stream left behind: its plain answer and the error code it streamed, if any; and
 * the mask its text crosses before the presenter renders it.
 */
interface StreamedTurn {
  answer: string
  error: string | undefined
  readonly mask: StreamMask
  /** Progress lines the display settings allow, waiting to be sent. */
  readonly progress: string[]
  readonly gate: ProgressGate
}

/**
 * Present one frame's events. The spread gives the frame an anonymous type, which the presenter's
 * index signature accepts. A streamed `finish` is dropped: it would emit and reset the presenter
 * before the one synthetic finish the reply is taken from (D8). Text is masked before the presenter
 * renders it: a platform's dialect rewrites marker pairs (`**`, `~~`, `_`), so a value holding one
 * no longer matches once rendered (LCR #78). The mask holds back an end that could still grow into
 * a value split across frames.
 */
function presentFrame(
  frame: { readonly type: string },
  presenter: ChatPresenter,
  streamed: StreamedTurn,
): void {
  for (const output of fromSdkMessage({ ...frame })) {
    if (output.type === 'error') streamed.error = output.code
    streamed.progress.push(...streamed.gate.lines(output))
    if (output.type === 'text') {
      // The answer before any platform rendering, for a broadcast group's thread and its other members.
      streamed.answer += output.text
      const released = streamed.mask.push(output.text)
      if (released !== '') presenter.present({ ...output, text: released })
    } else if (output.type !== 'finish') presenter.present(output)
  }
}

/** Present whatever text the mask still holds, masked, once the stream ends or fails. */
function flushMask(presenter: ChatPresenter, streamed: StreamedTurn): void {
  const rest = streamed.mask.flush()
  if (rest !== '') presenter.present({ type: 'text', text: rest })
}

/** Stream the agent's answer into the presenter; a failure is returned, not thrown. */
async function streamTurn(
  agent: TurnAgent,
  event: MessageEvent,
  prompt: string,
  presenter: ChatPresenter,
  secrets: readonly string[],
  gate: ProgressGate,
  sendProgress: (line: string) => Promise<void>,
): Promise<TurnOutcome> {
  // An ERROR or EXPIRED status in the stream fails the turn even when `wait()` reports it finished.
  const streamed: StreamedTurn = {
    answer: '',
    error: undefined,
    mask: createStreamMask(secrets),
    progress: [],
    gate,
  }
  try {
    const run = await agent.send(prompt, untrustedContentSendOptions())
    try {
      for await (const frame of run.stream()) {
        presentFrame(frame, presenter, streamed)
        for (const line of streamed.progress.splice(0)) await sendProgress(line)
      }
      for (const line of streamed.gate.flush()) await sendProgress(line)
    } finally {
      flushMask(presenter, streamed)
    }
    const result = await run.wait()
    if (result.status !== 'error' && streamed.error === undefined) {
      return {
        failed: false,
        answer: streamed.answer === '' ? NO_ANSWER_REPLY : streamed.answer,
        result,
      }
    }
    presenter.present(AGENT_ERROR)
    return {
      failed: true,
      error: new AgentTurnError(event.platform, result.error?.code ?? streamed.error),
    }
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
async function answerTurn(
  options: ReplyHandlerOptions,
  event: MessageEvent,
  ctx: GatewayContext,
  prompt: string,
): Promise<string> {
  const presenter = presenterFor(event)
  const secrets = options.secrets ?? []
  const gate = createProgressGate(
    resolveDisplay(event.platform, options.display),
    options.incognito === true,
  )
  // Best effort: a progress line that cannot be sent never fails the turn.
  const sendProgress = async (line: string): Promise<void> => {
    try {
      await ctx.reply(maskSecrets(line, secrets), { format: 'plain' })
    } catch {
      // the turn's own reply reports delivery problems
    }
  }
  let started = false
  try {
    return await options.withAgent(event, async (lease) => {
      started = true
      const stopTyping = showTyping(options.typing, event.platform, event.channel.id)
      try {
        const outcome = await streamTurn(
          lease.agent,
          event,
          prompt,
          presenter,
          secrets,
          gate,
          sendProgress,
        )
        // Masked before rendering (in the stream) and again after it, so a value is caught in the
        // model's text and in the platform's own format; the answer a broadcast group records and
        // fans out is masked before any member renders it.
        const reply = withFooter(finishTurn(presenter), options.usage, event, outcome)
        await send(ctx, { ...reply, text: maskSecrets(reply.text, secrets) }, outcome)
        if (outcome.failed) throw outcome.error
        if (options.compact !== undefined && lease.agentId !== undefined)
          await compactIfNeeded(options.compact, lease.agentId, outcome.result)
        return maskSecrets(outcome.answer, secrets)
      } finally {
        await stopTyping()
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

/**
 * The reply with the footer the conversation's `/usage` mode asks for, read now, as the reply is
 * sent (EC-7); a finished turn also writes its usage line. Only the sender's reply carries it: a
 * broadcast group's other members get the answer alone.
 */
function withFooter(
  reply: Pick<ChatMessage, 'text' | 'format'>,
  usage: ReplyUsageOptions | undefined,
  event: MessageEvent,
  outcome: TurnOutcome,
): Pick<ChatMessage, 'text' | 'format'> {
  if (usage === undefined || outcome.failed || outcome.result === undefined) return reply
  const record: TurnUsage = usageOf(outcome.result, usage.model)
  usage.write(formatUsageLine('channel', record))
  const mode = usage.modeFor(event)
  return mode === 'off'
    ? reply
    : { ...reply, text: `${reply.text}\n\n${formatUsageFooter(mode, record)}` }
}

/** Why one member could not be reached; a code or an error name, never the message or an id. */
async function sendToMember(
  adapter: BasePlatformAdapter | undefined,
  channelId: string,
  platform: string,
  answer: string,
): Promise<string | undefined> {
  if (adapter === undefined) return 'not started'
  // Rendered for the member's own platform, not the origin's dialect.
  return deliverText(adapter, platform as PlatformName, channelId, answer)
}

/** Send the answer to every other member, each on its own: one that fails costs only itself. */
async function fanOut(
  broadcast: BroadcastOptions,
  group: BroadcastGroup,
  event: MessageEvent,
  answer: string,
): Promise<void> {
  const others = group.members.filter(
    (member) => member.platform !== event.platform || member.channelId !== event.channel.id,
  )
  await Promise.all(
    others.map(async ({ platform, channelId }) => {
      const failure = await sendToMember(
        broadcast.adapterFor(platform),
        channelId,
        platform,
        answer,
      )
      if (failure !== undefined)
        broadcast.write(
          `broadcast group ${group.name}: ${platform}: the answer was not delivered (${failure})`,
        )
    }),
  )
}

/**
 * One `/goal`: a bare one gets the usage line and takes no lease; otherwise the session's agent runs
 * the goal loop and the person gets one reply, `<status>: <final text>`. A loop that threw is
 * rethrown after that reply, so the runner fires `on_error`. In a broadcast group it is the
 * session's own goal, with no fan-out.
 */
async function answerGoal(
  settings: GoalSettings,
  options: ReplyHandlerOptions,
  event: MessageEvent,
  ctx: GatewayContext,
  goal: string,
): Promise<void> {
  if (goal === '') {
    await send(
      ctx,
      { text: GOAL_USAGE_REPLY, format: 'plain' },
      { failed: false, answer: GOAL_USAGE_REPLY },
    )
    return
  }
  const outcome = await options.withAgent(event, async (lease) => {
    const stopTyping = showTyping(options.typing, event.platform, event.channel.id)
    try {
      return await runGoal(lease.agent, goal, settings)
    } finally {
      await stopTyping()
      lease.release()
    }
  })
  // B-398 FR-006 holds for a goal's reply too: no configured value reaches the chat.
  const reply = maskSecrets(outcome.reply, options.secrets ?? [])
  const failure: TurnOutcome =
    outcome.error === undefined
      ? { failed: false, answer: reply }
      : { failed: true, error: outcome.error }
  await send(ctx, { text: reply, format: 'plain' }, failure)
  if (outcome.error !== undefined) throw outcome.error
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
      await send(
        ctx,
        { text: NEW_CONVERSATION_REPLY, format: 'plain' },
        { failed: false, answer: NEW_CONVERSATION_REPLY },
      )
      return
    }
    const think = options.think === undefined ? undefined : THINK_COMMAND.exec(text)
    if (options.think !== undefined && think !== null && think !== undefined) {
      const reply = answerThink(options.think, event, think[1])
      await send(ctx, { text: reply, format: 'plain' }, { failed: false, answer: reply })
      return
    }
    if (options.compact !== undefined && compactOf(text) !== undefined) {
      const reply = await options.withAgent(event, (lease) =>
        runCompact(options.compact as CompactSettings, lease.agentId).finally(() =>
          lease.release(),
        ),
      )
      await send(ctx, { text: reply, format: 'plain' }, { failed: false, answer: reply })
      return
    }
    const goal = options.goal === undefined ? undefined : goalOf(text)
    if (options.goal !== undefined && goal !== undefined) {
      await answerGoal(options.goal, options, event, ctx, goal)
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
      // A member's own message joins the thread too, so it is masked as the answer is.
      group.record(event.platform, maskSecrets(event.text, options.secrets ?? []), answer)
      await fanOut(broadcast, group, event, answer)
    })
  }
}
