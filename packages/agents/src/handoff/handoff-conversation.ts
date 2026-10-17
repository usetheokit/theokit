// `createHandoffConversation` — one agent hands the conversation to another (B-410).
//
// `createDelegateTool` is call-and-return: the sub-agent answers the CALLER, and the caller keeps the
// turn. A handoff moves the turn itself, so the next message is answered by the receiver. That is a
// property of the conversation, not of one run, which is why this is an app-facing object holding a
// roster and the name of the agent that answers, rather than another tool factory.
//
// The transfer is a tool the answering agent gets for its run. Its handler only RECORDS the target;
// the conversation commits it after `run()` returns, because a run that fails after the tool call
// would otherwise leave the user with a responder whose turn never completed (plan ADR D1).
import { TheokitAgentError } from '@theokit/sdk/errors'
import { z } from 'zod'

import type { CompiledTool } from '../bridge/agent-compiler.js'
import type { SubAgentSpec } from '../bridge/agent-orchestrator.js'
import type { DelegationResult } from '../bridge/delegation-types.js'
import { AgentRunner, type AgentRunnerRunOptions } from '../loop/agent-runner.js'

/** The tool name the answering agent transfers with, after the `transfer_to_<agent>` convention. */
const TRANSFER_TOOL_NAME = 'transfer_to_agent'

/**
 * The marker a waiting note opens the receiver's message with. The note is model-written and the
 * message is the user's, so both are untrusted: the same marker inside either is rewritten to
 * {@link QUOTED_MARKER}, and only the conversation can open a message with a note.
 */
const NOTE_MARKER = '[Handoff from'
const QUOTED_MARKER = '[quoted: Handoff from'
const FORGED_MARKER = /\[\s*handoff\s+from/gi

/**
 * The conversation ids with a turn running, across every conversation of this module. The SDK keeps
 * one live agent per session id process-wide, so two conversations sharing an id must not run at
 * once: the second run could be handed the first one's agent, and with it the first one's transfer
 * tool.
 */
const runningConversationIds = new Set<string>()

export type HandoffErrorCode =
  | 'unknown_agent'
  | 'roster_too_small'
  | 'duplicate_name'
  | 'turn_in_progress'
  | 'step_ceiling_too_low'
  | 'reserved_tool_name'

/** A roster misconfiguration, an unknown target, or a call made while a turn is running. */
export class HandoffError extends TheokitAgentError {
  override readonly name = 'HandoffError'

  constructor(
    message: string,
    override readonly code: HandoffErrorCode,
  ) {
    super(message)
  }
}

export interface CreateHandoffConversationOptions {
  /** The agents the conversation can hand off between: at least 2, each with a unique name. */
  readonly agents: readonly SubAgentSpec[]
  /** The name of the agent that answers the first message. */
  readonly initial: string
  /**
   * Prefix of each agent's session id (`<conversationId>:<agentName>`). Default: a fresh UUID. Only
   * one conversation may run a turn on an id at a time; the responder and a waiting note live in
   * this object's memory, not in the id.
   */
  readonly conversationId?: string
}

/**
 * The run options a turn accepts: every `AgentRunner.run` option except the four the conversation
 * owns. The session id and the tool list are the conversation's; a `streamFactory` replaces the
 * adapter and with it the transfer tool; a per-run `maxIterations` of 1 disables tools in round 1.
 */
export type HandoffSendOptions = Omit<
  AgentRunnerRunOptions,
  'sessionId' | 'tools' | 'streamFactory' | 'maxIterations'
>

/** A transfer committed by a turn. */
export interface HandoffTransfer {
  readonly from: string
  readonly to: string
  readonly note: string
}

/** One turn's result: the run's result, the agent that answered it, and the transfer it made. */
export interface HandoffTurn extends DelegationResult {
  readonly responder: string
  readonly handoff?: HandoffTransfer
}

export interface HandoffConversation {
  readonly conversationId: string
  /** The agent that answers the next message. */
  readonly responder: string
  /**
   * Run one turn on the current responder. Rejects with `turn_in_progress` while a turn runs on
   * this conversation or on another one with the same `conversationId`, and with
   * `reserved_tool_name` when `opts.sdkTools` names `transfer_to_agent`.
   */
  send(message: string, opts: HandoffSendOptions): Promise<HandoffTurn>
  /**
   * Move the next turn to `name`; `note` is put in front of that agent's next message. Naming the
   * agent that already answers changes nothing, and its `note` is not kept.
   */
  handoffTo(name: string, note?: string): void
}

/** One roster agent as the conversation runs it: its runner and its tools plus the transfer. */
interface RosterAgent {
  readonly runner: AgentRunner
  readonly tools: readonly CompiledTool[]
}

interface WaitingNote {
  readonly from: string
  readonly note: string
}

function assertUsableRoster(agents: readonly SubAgentSpec[], initial: string): void {
  if (agents.length < 2) {
    throw new HandoffError(
      `createHandoffConversation: a handoff needs at least 2 agents, the roster holds ${agents.length}.`,
      'roster_too_small',
    )
  }
  const seen = new Set<string>()
  for (const spec of agents) {
    if (seen.has(spec.name)) {
      throw new HandoffError(
        `createHandoffConversation: duplicate agent name ${JSON.stringify(spec.name)}; each agent must be uniquely addressable.`,
        'duplicate_name',
      )
    }
    seen.add(spec.name)
    assertNoTransferTool(
      spec.compiled.tools,
      `createHandoffConversation: agent ${JSON.stringify(spec.name)} already has`,
    )
    if (spec.maxIterations === 1) {
      // The runner disables tools on the ceiling round, and a ceiling of 1 makes round 1 that round:
      // the agent would never be offered the transfer tool, and nothing would say so.
      throw new HandoffError(
        `createHandoffConversation: agent ${JSON.stringify(spec.name)} has maxIterations 1, which disables tools in its only round and with them the transfer.`,
        'step_ceiling_too_low',
      )
    }
  }
  assertKnown(seen, initial)
}

function assertNoTransferTool(tools: readonly { readonly name: string }[], owner: string): void {
  if (tools.some((tool) => tool.name === TRANSFER_TOOL_NAME)) {
    // The SDK refuses two tools of one name when it builds the agent, which is the agent's first
    // turn, not here: the error would arrive late and as another type.
    throw new HandoffError(
      `${owner} a tool named ${TRANSFER_TOOL_NAME}, which the conversation reserves for the transfer.`,
      'reserved_tool_name',
    )
  }
}

/** `text` with every note marker it carries rewritten, so it cannot pass for a note. */
function quoteMarkers(text: string): string {
  return text.replace(FORGED_MARKER, QUOTED_MARKER)
}

function unknownAgent(names: ReadonlySet<string>, name: string): HandoffError {
  return new HandoffError(
    `handoff: unknown agent ${JSON.stringify(name)}; the roster holds ${[...names].join(', ')}.`,
    'unknown_agent',
  )
}

function assertKnown(names: ReadonlySet<string>, name: string): void {
  if (!names.has(name)) throw unknownAgent(names, name)
}

function transferTool(
  from: string,
  others: readonly [string, ...string[]],
  onTransfer: (to: string, note: string) => void,
): CompiledTool {
  const inputSchema = z.object({
    agent: z
      .enum(others)
      .describe(`Which agent answers the next message. One of: ${others.join(', ')}.`),
    note: z
      .string()
      .min(1)
      .describe('What the receiving agent needs to know to continue without asking again.'),
  })
  return {
    name: TRANSFER_TOOL_NAME,
    description:
      `Hand this conversation to another agent (${others.join(', ')}). The receiving agent answers ` +
      `the user's NEXT message and reads your note first; you still answer this one. Use it when ` +
      `the request belongs to that agent, not to you (${from}).`,
    inputSchema,
    handler: (raw: unknown): string => {
      // The SDK validates against this schema before the handler runs; the parse types the input.
      const { agent, note } = inputSchema.parse(raw)
      onTransfer(agent, note)
      return `Transfer to ${agent} recorded. ${agent} answers the user's next message.`
    },
  }
}

class RosterConversation implements HandoffConversation {
  readonly conversationId: string
  private current: string
  private running = false
  private pending: { readonly to: string; readonly note: string } | undefined
  private waiting: WaitingNote | undefined
  private readonly names: ReadonlySet<string>
  private readonly agents = new Map<string, RosterAgent>()

  constructor(options: CreateHandoffConversationOptions) {
    // Validated first: the `others` tuple below is non-empty only because the roster holds 2+
    // unique names.
    assertUsableRoster(options.agents, options.initial)
    this.conversationId = options.conversationId ?? crypto.randomUUID()
    this.current = options.initial
    this.names = new Set(options.agents.map((spec) => spec.name))
    for (const spec of options.agents) {
      const others = options.agents
        .map((other) => other.name)
        .filter((name) => name !== spec.name) as [string, ...string[]]
      const transfer = transferTool(spec.name, others, (to, note) => {
        this.pending = { to, note }
      })
      this.agents.set(spec.name, {
        runner: AgentRunner.fromSpec(spec).build(),
        tools: [...spec.compiled.tools, transfer],
      })
    }
  }

  get responder(): string {
    return this.current
  }

  async send(message: string, opts: HandoffSendOptions): Promise<HandoffTurn> {
    // Checked and set before the first `await`, so a second call in the same tick sees it.
    if (this.running) throw this.turnInProgress('send')
    if (runningConversationIds.has(this.conversationId)) throw this.idInUse()
    assertNoTransferTool(opts.sdkTools ?? [], 'send: opts.sdkTools has')
    this.running = true
    runningConversationIds.add(this.conversationId)
    try {
      return await this.runTurn(message, opts)
    } finally {
      this.running = false
      runningConversationIds.delete(this.conversationId)
    }
  }

  handoffTo(name: string, note?: string): void {
    if (this.running) throw this.turnInProgress('handoffTo')
    assertKnown(this.names, name)
    if (name === this.current) return
    this.waiting = note === undefined ? undefined : { from: this.current, note }
    this.current = name
  }

  private async runTurn(message: string, opts: HandoffSendOptions): Promise<HandoffTurn> {
    const from = this.current
    this.pending = undefined
    // `Omit` refuses these fields only in a fresh object literal; a wider object passed through a
    // variable still carries them, so they are dropped here before the runner can read them.
    const wide: AgentRunnerRunOptions = opts
    const {
      sessionId: _sessionId,
      tools: _tools,
      streamFactory: _streamFactory,
      maxIterations: _maxIterations,
      ...run
    } = wide
    const agent = this.agentOf(from)
    const result = await agent.runner.run(this.withWaitingNote(message), {
      ...run,
      sessionId: `${this.conversationId}:${from}`,
      tools: agent.tools,
    })
    // A cancelled run RETURNS a partial result instead of throwing: nothing is committed and the
    // waiting note stays for the turn that does run.
    if (opts.signal?.aborted === true) return { ...result, responder: from }
    this.waiting = undefined
    const transfer = this.takePending()
    if (transfer === undefined) return { ...result, responder: from }
    this.current = transfer.to
    this.waiting = { from, note: transfer.note }
    return { ...result, responder: from, handoff: { from, to: transfer.to, note: transfer.note } }
  }

  /** The transfer the run's tool call recorded, read once; the handler writes it during `run()`. */
  private takePending(): { readonly to: string; readonly note: string } | undefined {
    const transfer = this.pending
    this.pending = undefined
    return transfer
  }

  private withWaitingNote(message: string): string {
    const quoted = quoteMarkers(message)
    if (this.waiting === undefined) return quoted
    return `${NOTE_MARKER} ${this.waiting.from}] ${quoteMarkers(this.waiting.note)}\n\n${quoted}`
  }

  private agentOf(name: string): RosterAgent {
    const agent = this.agents.get(name)
    if (agent === undefined) throw unknownAgent(this.names, name)
    return agent
  }

  private idInUse(): HandoffError {
    return new HandoffError(
      `handoff: send() was called while another conversation runs a turn on conversationId ${JSON.stringify(this.conversationId)}; one conversation id belongs to one conversation at a time.`,
      'turn_in_progress',
    )
  }

  private turnInProgress(call: 'send' | 'handoffTo'): HandoffError {
    return new HandoffError(
      `handoff: ${call}() was called while a turn is running on ${JSON.stringify(this.current)}; await the running send() first.`,
      'turn_in_progress',
    )
  }
}

/**
 * Create a conversation that one agent can hand to another.
 *
 * Each agent runs on its own session (`<conversationId>:<agentName>`) and is offered a
 * `transfer_to_agent` tool naming the other agents. A transfer the agent requests is committed when
 * its run returns normally and was not cancelled, so the NEXT `send()` is answered by the target,
 * which reads the transferring agent's note before the user's message. The note is written by a
 * model and the message by the user; neither can open the receiver's message with a note, because
 * `[Handoff from` inside either is rewritten to `[quoted: Handoff from`.
 *
 * The responder and a waiting note live in memory. To resume after a restart, keep the last
 * `turn.handoff`, create the conversation with `initial` set to its `to`, and pass its note to
 * `handoffTo` if the receiver has not answered yet.
 *
 * @throws {HandoffError} `roster_too_small`, `duplicate_name`, `step_ceiling_too_low`,
 *   `reserved_tool_name` or `unknown_agent` (for `initial`) at creation.
 */
export function createHandoffConversation(
  options: CreateHandoffConversationOptions,
): HandoffConversation {
  return new RosterConversation(options)
}
