import type { BasePlatformAdapter, GatewayContext, GatewayHandler, MessageEvent, SendResult } from '@theokit/gateway'
import { createCommandRegistry, defineCommand } from '@theokit/agents/commands'
import type { ChatMessage } from '@theokit/presenter'

import type { TurnAgent, TurnRun } from '../agent-port.js'
import { maskSecrets } from '@theokit/gateway'
import { type BroadcastOptions, createMaskedBroadcast } from './broadcast-groups.js'
import { type DisplayConfig, resolveDisplay } from './display-config.js'
import { createProgressGate } from './progress.js'
import { AgentTurnError, createAgentHandler } from '@theokit/gateway-agent'
import type { AgentLease, BroadcastGroups, RunningTurn } from '@theokit/gateway-agent'
import { type GoalSettings, GOAL_USAGE_REPLY, runGoal } from './goal-command.js'
import type { SessionLease } from '../sessions/session-agents.js'
import { formatUsageFooter, formatUsageLine, usageOf } from '../usage/turn-usage.js'
import type { UsageMode } from './usage-hook.js'
import { THINKING_LEVELS, type ThinkingLevel } from '../agent/create-agent.js'
import { type CompactSettings, compactIfNeeded, runCompact } from './compact-command.js'
import { AdvisorHistory, reviewQuietly, steerNote, type AdvisorSettings } from './advisor.js'

/** The reply to a turn that produced no visible answer (D8): reasoning only, tools only, nothing. */
export const NO_ANSWER_REPLY = 'I could not come up with an answer to that.'

/** The one line `/new` and `/reset` answer with. */
export const NEW_CONVERSATION_REPLY = 'Started a new conversation.'

/** The one line a `/new` or `/reset` that could not be saved answers with. */
export const RESET_FAILED_REPLY = 'I could not start a new conversation; this one goes on.'

export const STEER_USAGE_REPLY = 'Usage: /steer <text> (redirects the turn that is running)'
export const STEER_IDLE_REPLY = 'Nothing is running to steer; send your message as usual.'
export const STEERED_REPLY = 'Steering the running turn.'

/** The turns each session agent is running now, so `/steer` knows whether there is one to redirect. */
const activeTurns = new WeakMap<object, Set<object>>()

/** Note a running turn of `agent`; the returned function removes exactly that entry. */
function trackTurn(agent: object, turn: object): () => void {
  const turns = activeTurns.get(agent) ?? new Set<object>()
  turns.add(turn)
  activeTurns.set(agent, turns)
  return () => void turns.delete(turn)
}

function answerThink(think: (event: MessageEvent, level: ThinkingLevel) => void, event: MessageEvent, arg: string): string {
  const level = arg.toLowerCase()
  if ( !(THINKING_LEVELS as readonly string[]).includes(level)) return `Usage: /think ${THINKING_LEVELS.join('|')} (only these four levels)`
  think(event, level as ThinkingLevel)
  return `Thinking level set to ${level}.`
}

export type { TurnAgent, TurnRun } from '../agent-port.js'
export type { BroadcastOptions } from './broadcast-groups.js'

export interface ReplyHandlerOptions {
  /**
   * One request boundary per message, holding a lease on the agent of the message's session; the
   * composition root's chat `withAgent`.
   */
  readonly withAgent: <R>(event: MessageEvent, work: (lease: SessionLease) => R | Promise<R>) => Promise<R>
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
  /**
   * `THEOCLAW_ACK_REACTION`: the emoji that reacts to an inbound message when its turn starts, and
   * the started adapters that send it. Typing while a turn runs is the runner's, not this handler's.
   */
  readonly ack?: { readonly emoji: string; readonly adapters: () => readonly BasePlatformAdapter[] }
  /** `THEOCLAW_ADVISOR=on` (OC-118): a reviewer that steers the running turn; without it, none. */
  readonly advisor?: AdvisorSettings
}

export interface ReplyUsageOptions {
  /** The conversation's `/usage` mode, read when the reply is sent (EC-7). */
  readonly modeFor: (event: MessageEvent) => UsageMode
  /** The model the chat agents run (`THEOCLAW_MODEL`). */
  readonly model: string
  /** Where the usage line goes; the masked write. */
  readonly write: (line: string) => void
}

export { AgentTurnError }

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

/** The one line a turn that failed answers with. */
const ERROR_REPLY = 'Something went wrong on my side and I could not finish that.'

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

/** The advisor's review of one running turn: its advice steers the turn while it runs, never after. */
interface AdvisorWatch {
  start(agent: TurnAgent, prompt: string): void
  stop(): void
  record(answer: string): void
}

function watchTurn(settings: AdvisorSettings, history: AdvisorHistory, key: string): AdvisorWatch {
  let running = true
  let prompt = ''
  return {
    start(agent, text) {
      prompt = text
      void reviewQuietly(settings, history.of(key), text).then(async (advice) => {
        if (advice === undefined) {
          settings.write(`advisor: no correction for session ${key}`)
          return
        }
        if (!running) return
        try {
          await agent.send(steerNote(advice), { queueMode: 'steer' })
          settings.write(`advisor: steered session ${key}: ${advice}`)
        } catch {
          settings.write(`advisor: could not steer session ${key}`)
        }
      })
    },
    stop() {
      running = false
    },
    record(answer) {
      history.record(key, { user: prompt, answer })
    },
  }
}

const advisorHistories = new WeakMap<AdvisorSettings, AdvisorHistory>()

function advisorHistoryOf(settings: AdvisorSettings): AdvisorHistory {
  const found = advisorHistories.get(settings) ?? new AdvisorHistory()
  advisorHistories.set(settings, found)
  return found
}

/**
 * One agent turn on the event's prompt, and exactly one reply to the origin (FR-004, D8), by the
 * package's `createAgentHandler`. A failed turn still replies, then throws so the runner fires
 * `on_error`. The agent is the session's, owned by `SessionAgents`: the request boundary of
 * `withAgent` stays open until the handler releases the lease, after the reply. The package's
 * hooks carry the rest: `onTurnStart` (steering, advisor), `decorateReply` (the `/usage` footer)
 * and `onTurnEnd` (advisor history, compaction, a broadcast group's thread and fan-out).
 */
async function answerTurn(options: ReplyHandlerOptions, broadcast: BroadcastGroups | undefined, event: MessageEvent, ctx: GatewayContext): Promise<void> {
  const secrets = options.secrets ?? []
  const gate = createProgressGate(resolveDisplay(event.platform, options.display), options.incognito === true)
  let boundary: Promise<void> = Promise.resolve()
  let agentId: string | undefined
  let sessionAgent: TurnAgent | undefined
  let advisor: AdvisorWatch | undefined
  let prompt = ''
  let result: Promise<Awaited<ReturnType<TurnRun['wait']>> | undefined> | undefined
  let answer = ''
  let streamFailed = false
  const agentFor = (forEvent: MessageEvent): Promise<AgentLease> =>
    new Promise<AgentLease>((resolve, reject) => {
      boundary = options.withAgent(forEvent, (lease) =>
        new Promise<void>((released) => {
          agentId = lease.agentId
          sessionAgent = lease.agent
          // Counted from the lease, as before, so a `/steer` finds the turn until it is released.
          const untrack = trackTurn(lease.agent, {})
          resolve({
            agent: lease.agent,
            // The package releases before `onTurnEnd`, so compaction runs here, while the lease is held.
            release: async () => {
              try {
                const run = await result
                if (options.compact !== undefined && lease.agentId !== undefined && run !== undefined && run.status !== 'error' && run.status !== 'cancelled' && !streamFailed) {
                  await compactIfNeeded(options.compact, lease.agentId, run)
                }
              } finally {
                untrack()
                try {
                  lease.release()
                } finally {
                  released()
                }
              }
            },
          })
        }),
      )
      boundary.catch(reject)
    })
  const handler = createAgentHandler({
    agentFor,
    prompt: (forEvent) => {
      prompt = broadcast === undefined ? forEvent.text : broadcast.prompt(forEvent)
      return prompt
    },
    noAnswerText: NO_ANSWER_REPLY,
    errorText: ERROR_REPLY,
    secrets,
    progress: (output) => {
      if (output.type === 'error') streamFailed = true
      const lines = gate.lines(output)
      return lines.length === 0 ? undefined : lines.join('\n')
    },
    onTurnStart: (_forEvent, turn: RunningTurn) => {
      result = turn.run.wait().catch(() => undefined)
      if (options.advisor !== undefined) {
        advisor = watchTurn(options.advisor, advisorHistoryOf(options.advisor), agentId ?? event.channel.id)
        if (sessionAgent !== undefined) advisor.start(sessionAgent, prompt)
      }
      return () => advisor?.stop()
    },
    decorateReply: async (reply) => {
      answer = reply
      const usage = options.usage
      const run = await result
      if (usage === undefined || run === undefined || run.status === 'error') return reply
      const turn = usageOf(run, usage.model)
      usage.write(formatUsageLine('channel', turn))
      const mode = usage.modeFor(event)
      return mode === 'off' ? reply : `${reply}\n\n${formatUsageFooter(mode, turn)}`
    },
    onTurnEnd: async (forEvent, outcome) => {
      if (!outcome.failed) {
        advisor?.record(answer)
      }
      // The thread and the other members get the answer without the usage footer.
      await broadcast?.onTurnEnd(forEvent, { ...outcome, text: answer === '' ? outcome.text : answer })
    },
    ...(options.ack === undefined ? {} : { ackEmoji: options.ack.emoji, adapters: [...options.ack.adapters()] }),
  })
  let failure: { readonly error: unknown } | undefined
  try {
    await (broadcast === undefined ? handler : broadcast.wrap(handler))(event, ctx)
  } catch (error) {
    failure = { error }
  }
  // The boundary's own failure (a disposal that threw) surfaces when the turn itself did not fail.
  const disposal = await boundary.then(() => undefined, (error: unknown) => ({ error }))
  const thrown = failure ?? disposal
  if (thrown !== undefined) throw thrown.error
}

/** Inject `note` into the session's running turn; with none running, nothing is sent and the person is told. */
async function answerSteer(options: ReplyHandlerOptions, event: MessageEvent, note: string): Promise<string> {
  return options.withAgent(event, async (lease) => {
    try {
      if ((activeTurns.get(lease.agent)?.size ?? 0) === 0) return STEER_IDLE_REPLY
      await lease.agent.send(note, { queueMode: 'steer' })
      return STEERED_REPLY
    } finally {
      lease.release()
    }
  })
}

/**
 * One `/goal`: a bare one gets the usage line and takes no lease; otherwise the session's agent runs
 * the goal loop and the person gets one reply, `<status>: <final text>`. A loop that threw is
 * rethrown after that reply, so the runner fires `on_error`. In a broadcast group it is the
 * session's own goal, with no fan-out.
 */
async function answerGoal(settings: GoalSettings, options: ReplyHandlerOptions, event: MessageEvent, ctx: GatewayContext, goal: string): Promise<void> {
  if (goal === '') {
    await send(ctx, { text: GOAL_USAGE_REPLY, format: 'plain' }, { failed: false, answer: GOAL_USAGE_REPLY })
    return
  }
  const outcome = await options.withAgent(event, async (lease) => {
    const untrack = trackTurn(lease.agent, {})
    try {
      return await runGoal(lease.agent, goal, settings)
    } finally {
      untrack()
      lease.release()
    }
  })
  // B-398 FR-006 holds for a goal's reply too: no configured value reaches the chat.
  const reply = maskSecrets(outcome.reply, options.secrets ?? [])
  const failure: TurnOutcome = outcome.error === undefined ? { failed: false, answer: reply } : { failed: true, error: outcome.error }
  await send(ctx, { text: reply, format: 'plain' }, failure)
  if (outcome.error !== undefined) throw outcome.error
}

/** What a channel command acts on: the message and the reply path it arrived on. */
interface ChannelCommandContext {
  readonly event: MessageEvent
  readonly ctx: GatewayContext
}

/** `/think` and `/steer` have always been matched without regard to case; the router's match is exact. */
function normalised(text: string): string {
  return text
    .replace(/^\/(steer|think)(?=\s|$)/i, (_all, name: string) => `/${name.toLowerCase()}`)
    .replace(/^(\/\w+)\s/, '$1 ')
}

/**
 * The commands this handler answers itself, in one registry. `/new` and `/reset` are `exact`, so
 * `/new chat` is no command and goes to the model (FR-008); `/think`, `/compact` and `/goal` exist
 * only when their option does, and without it they are ordinary messages.
 */
function channelCommands(options: ReplyHandlerOptions) {
  const say = async ({ ctx }: ChannelCommandContext, text: string): Promise<void> =>
    send(ctx, { text, format: 'plain' }, { failed: false, answer: text })
  const { think, compact, goal } = options
  return createCommandRegistry<ChannelCommandContext>([
    defineCommand<ChannelCommandContext>({
      name: 'new',
      aliases: ['reset'],
      description: 'start a new conversation',
      exact: true,
      // No lease and no model turn: a session whose agent cannot be resolved can still be reset.
      // A reset that could not be saved moved nothing; the person is told, and the runner too.
      run: async (_arg, c) => {
        try {
          await options.reset(c.event)
        } catch (error) {
          await send(c.ctx, { text: RESET_FAILED_REPLY, format: 'plain' }, { failed: true, error })
          throw error
        }
        await say(c, NEW_CONVERSATION_REPLY)
      },
    }),
    defineCommand<ChannelCommandContext>({
      name: 'steer',
      description: 'redirect the turn that is running',
      run: async (arg, c) =>
        say(c, arg === '' ? STEER_USAGE_REPLY : await answerSteer(options, c.event, arg)),
    }),
    ...(think === undefined
      ? []
      : [
          defineCommand<ChannelCommandContext>({
            name: 'think',
            description: 'the thinking level',
            run: (arg, c) => say(c, answerThink(think, c.event, arg)),
          }),
        ]),
    ...(compact === undefined
      ? []
      : [
          defineCommand<ChannelCommandContext>({
            name: 'compact',
            description: 'summarize the conversation so far',
            run: async (_arg, c) =>
              say(
                c,
                await options.withAgent(c.event, (lease) =>
                  runCompact(compact, lease.agentId).finally(() => lease.release()),
                ),
              ),
          }),
        ]),
    ...(goal === undefined
      ? []
      : [
          defineCommand<ChannelCommandContext>({
            name: 'goal',
            description: 'work on a goal',
            run: (arg, c) => answerGoal(goal, options, c.event, c.ctx, arg),
          }),
        ]),
  ])
}

/**
 * The handler every runner uses: one agent turn per message with text, on the agent of the
 * message's session. In a broadcast group's member channel the turn carries the group's thread,
 * runs after the group's earlier turns, and its answer also reaches every other member; the
 * exchange joins the thread only once the origin was answered. The agent is never closed or
 * disposed here: it is the session's, owned by `SessionAgents`.
 */
export function createReplyHandler(options: ReplyHandlerOptions): GatewayHandler {
  const registry = channelCommands(options)
  const broadcast = options.broadcast === undefined ? undefined : createMaskedBroadcast({ secrets: options.secrets ?? [], ...options.broadcast })
  return async (event, ctx) => {
    const text = event.text.trim()
    if (text === '') return
    const routed = await registry.dispatch(normalised(text), { event, ctx })
    if (routed.kind === 'command') return
    await answerTurn(options, broadcast, event, ctx)
  }
}
