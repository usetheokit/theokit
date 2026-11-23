import type { BasePlatformAdapter, GatewayContext, GatewayHandler, MessageEvent, SendResult } from '@theokit/gateway'
import { fromSdkMessage } from '@theokit/presenter'
import type { ChatMessage } from '@theokit/presenter'

import type { TurnAgent, TurnRun } from '../agent-port.js'
import { maskSecrets } from './channel-loop.js'
import type { BroadcastGroup, BroadcastGroups } from './broadcast-groups.js'
import { type DisplayConfig, resolveDisplay } from './display-config.js'
import { createProgressGate } from './progress.js'
import { compactIfNeeded } from './compact-command.js'
import { AgentTurnError, createAgentHandler, deliverText } from '@theokit/gateway-agent'
import type { AgentLease } from '@theokit/gateway-agent'
import { type GoalSettings, GOAL_USAGE_REPLY, goalOf, runGoal } from './goal-command.js'
import type { SessionLease } from '../sessions/session-agents.js'
import { formatUsageFooter, formatUsageLine, type TurnUsage, usageOf } from '../usage/turn-usage.js'
import type { UsageMode } from './usage-hook.js'
import { THINKING_LEVELS, type ThinkingLevel } from '../agent/create-agent.js'
import { type CompactSettings, compactOf, runCompact } from './compact-command.js'
import { AdvisorHistory, reviewQuietly, steerNote, type AdvisorSettings } from './advisor.js'

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

/** `/steer <text>`: redirect the turn already running; the text after the command is what is injected. */
const STEER_COMMAND = /^\/steer(?:\s+([\s\S]*))?$/i

export const STEER_USAGE_REPLY = 'Usage: /steer <text> (redirects the turn that is running)'
export const STEER_IDLE_REPLY = 'Nothing is running to steer; send your message as usual.'
export const STEERED_REPLY = 'Steering the running turn.'

/** How many turns each session agent is running now, so `/steer` knows whether there is one to redirect. */
const runningTurns = new WeakMap<object, number>()

function turnStarted(agent: object): void {
  runningTurns.set(agent, (runningTurns.get(agent) ?? 0) + 1)
}

function turnEnded(agent: object): void {
  runningTurns.set(agent, Math.max(0, (runningTurns.get(agent) ?? 1) - 1))
}

const THINK_COMMAND = /^\/think(?:\s+(\S+))?$/i

function answerThink(think: (event: MessageEvent, level: ThinkingLevel) => void, event: MessageEvent, arg: string | undefined): string {
  const level = arg?.toLowerCase()
  if (level === undefined || !(THINKING_LEVELS as readonly string[]).includes(level)) return `Usage: /think ${THINKING_LEVELS.join('|')} (only these four levels)`
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

/** What one turn left behind, read after the package handler has replied. */
interface TurnRecord {
  answer: string
  streamFailed: boolean
  result?: Awaited<ReturnType<TurnRun['wait']>>
}

/**
 * The session agent as the package handler sees it. The stream passes through untouched; the
 * wrapper only notes the answer and the result (for usage, compaction, advisor and a broadcast
 * group's fan-out), and ends the stream with the `/usage` footer, which the handler masks and
 * replies with like any other text.
 */
function observed(agent: TurnAgent, record: TurnRecord, options: ReplyHandlerOptions, event: MessageEvent, advisor: AdvisorWatch | undefined): TurnAgent {
  return {
    send: async (prompt, sendOptions) => {
      const run = await agent.send(prompt, sendOptions)
      advisor?.start(agent, typeof prompt === 'string' ? prompt : prompt.text)
      let waiting: ReturnType<TurnRun['wait']> | undefined
      const wait = (): ReturnType<TurnRun['wait']> => {
        waiting ??= run.wait().then((result) => {
          record.result = result
          return result
        })
        return waiting
      }
      return {
        ...run,
        wait,
        stream: async function* () {
          try {
            for await (const frame of run.stream()) {
              for (const output of fromSdkMessage({ ...frame })) {
                if (output.type === 'text') record.answer += output.text
                else if (output.type === 'error') record.streamFailed = true
              }
              yield frame
            }
          } finally {
            advisor?.stop()
          }
          const usage = options.usage
          if (usage === undefined || record.streamFailed) return
          const result = await wait()
          if (result.status === 'error') return
          const turn: TurnUsage = usageOf(result, usage.model)
          usage.write(formatUsageLine('channel', turn))
          const mode = usage.modeFor(event)
          if (mode !== 'off') yield assistantText(`\n\n${formatUsageFooter(mode, turn)}`)
        },
      }
    },
  }
}

function assistantText(text: string): { readonly type: string; readonly message: unknown } {
  return { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } }
}

/**
 * One agent turn on `prompt`, and exactly one reply to the origin (FR-004, D8), by the package's
 * `createAgentHandler`. A failed turn still replies, then throws so the runner fires `on_error`.
 * Resolves the answer of a turn that succeeded. The agent is the session's, owned by
 * `SessionAgents`: the request boundary of `withAgent` stays open until the handler releases the
 * lease, after the reply.
 */
async function answerTurn(options: ReplyHandlerOptions, event: MessageEvent, ctx: GatewayContext, prompt: string): Promise<string> {
  const secrets = options.secrets ?? []
  const gate = createProgressGate(resolveDisplay(event.platform, options.display), options.incognito === true)
  const record: TurnRecord = { answer: '', streamFailed: false }
  let boundary: Promise<void> = Promise.resolve()
  const agentFor = (forEvent: MessageEvent): Promise<AgentLease> =>
    new Promise<AgentLease>((resolve, reject) => {
      boundary = options.withAgent(forEvent, (lease) =>
        new Promise<void>((released) => {
          turnStarted(lease.agent)
          const advisor = options.advisor === undefined ? undefined : watchTurn(options.advisor, advisorHistoryOf(options.advisor), lease.agentId ?? event.channel.id)
          resolve({
            agent: observed(lease.agent, record, options, event, advisor),
            release: async () => {
              try {
                const result = record.result
                if (result !== undefined && result.status !== 'error' && !record.streamFailed) {
                  advisor?.record(record.answer)
                  if (options.compact !== undefined && lease.agentId !== undefined) await compactIfNeeded(options.compact, lease.agentId, result)
                }
              } finally {
                turnEnded(lease.agent)
                lease.release()
                released()
              }
            },
          })
        }),
      )
      boundary.catch(reject)
    })
  const handler = createAgentHandler({
    agentFor,
    prompt: () => prompt,
    noAnswerText: NO_ANSWER_REPLY,
    errorText: ERROR_REPLY,
    secrets,
    progress: (output) => {
      const lines = gate.lines(output)
      return lines.length === 0 ? undefined : lines.join('\n')
    },
    ...(options.ack === undefined ? {} : { ackEmoji: options.ack.emoji, adapters: [...options.ack.adapters()] }),
  })
  let failure: { readonly error: unknown } | undefined
  try {
    await handler(event, ctx)
  } catch (error) {
    failure = { error }
  }
  // The boundary's own failure (a disposal that threw) surfaces when the turn itself did not fail.
  const disposal = await boundary.then(() => undefined, (error: unknown) => ({ error }))
  const thrown = failure ?? disposal
  if (thrown !== undefined) throw thrown.error
  return maskSecrets(record.answer === '' ? NO_ANSWER_REPLY : record.answer, secrets)
}

/** Inject `note` into the session's running turn; with none running, nothing is sent and the person is told. */
async function answerSteer(options: ReplyHandlerOptions, event: MessageEvent, note: string): Promise<string> {
  return options.withAgent(event, async (lease) => {
    try {
      if ((runningTurns.get(lease.agent) ?? 0) === 0) return STEER_IDLE_REPLY
      await lease.agent.send(note, { queueMode: 'steer' })
      return STEERED_REPLY
    } finally {
      lease.release()
    }
  })
}

/** Why one member could not be reached; a code or an error name, never the message or an id. */
async function sendToMember(adapter: BasePlatformAdapter | undefined, channelId: string, answer: string): Promise<string | undefined> {
  if (adapter === undefined) return 'not started'
  // Rendered for the member's own platform, not the origin's dialect.
  return deliverText(adapter, channelId, answer, 'group')
}

/** Send the answer to every other member, each on its own: one that fails costs only itself. */
async function fanOut(broadcast: BroadcastOptions, group: BroadcastGroup, event: MessageEvent, answer: string): Promise<void> {
  const others = group.members.filter((member) => member.platform !== event.platform || member.channelId !== event.channel.id)
  await Promise.all(
    others.map(async ({ platform, channelId }) => {
      const failure = await sendToMember(broadcast.adapterFor(platform), channelId, answer)
      if (failure !== undefined) broadcast.write(`broadcast group ${group.name}: ${platform}: the answer was not delivered (${failure})`)
    }),
  )
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
    turnStarted(lease.agent)
    try {
      return await runGoal(lease.agent, goal, settings)
    } finally {
      turnEnded(lease.agent)
      lease.release()
    }
  })
  // B-398 FR-006 holds for a goal's reply too: no configured value reaches the chat.
  const reply = maskSecrets(outcome.reply, options.secrets ?? [])
  const failure: TurnOutcome = outcome.error === undefined ? { failed: false, answer: reply } : { failed: true, error: outcome.error }
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
      await send(ctx, { text: NEW_CONVERSATION_REPLY, format: 'plain' }, { failed: false, answer: NEW_CONVERSATION_REPLY })
      return
    }
    const steer = STEER_COMMAND.exec(text)
    if (steer !== null) {
      const note = (steer[1] ?? '').trim()
      const reply = note === '' ? STEER_USAGE_REPLY : await answerSteer(options, event, note)
      await send(ctx, { text: reply, format: 'plain' }, { failed: false, answer: reply })
      return
    }
    const think = options.think === undefined ? null : THINK_COMMAND.exec(text)
    if (options.think !== undefined && think !== null) {
      const reply = answerThink(options.think, event, think[1])
      await send(ctx, { text: reply, format: 'plain' }, { failed: false, answer: reply })
      return
    }
    if (options.compact !== undefined && compactOf(text) !== undefined) {
      const reply = await options.withAgent(event, (lease) => runCompact(options.compact as CompactSettings, lease.agentId).finally(() => lease.release()))
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
