import { parseChatCommand } from '@theokit/gateway'
import type { ChatCommand, GatewayHook, HookDecision, MessageEvent } from '@theokit/gateway'
import { createChatApprover } from '@theokit/gateway-agent'

import type { ExecApprovalOptions, PersonReply } from '../tools/exec-approval.js'

/** The variable that sets the default of `/elevated`: `on` waives the exec question for every session. */
export const ELEVATED_VARIABLE = 'THEOCLAW_ELEVATED'
/** How long an exec waits for `/approve` or `/deny` before it is refused (B-572). */
export const EXEC_APPROVAL_TIMEOUT_MS = 120_000

const HOOK_NAME = 'theoclaw-exec-approval-chat'
/** What `/help` says about the commands this hook answers. */
export const EXEC_DESCRIPTIONS: readonly Pick<ChatCommand, 'name' | 'usage' | 'description'>[] = [
  { name: 'approve', usage: '/approve [always], /deny', description: 'answer an exec waiting for approval' },
  {
    name: 'elevated',
    usage: '/elevated on|off',
    description: "run this session's shell outside the sandbox, without asking",
  },
]
/** The id of a session's agent is `theoclaw-<session key>-g<generation>` (`agentIdFor`). */
const AGENT_ID = /^theoclaw-(.+)-g\d+$/

export interface ChatExecApprovalOptions {
  readonly env: Readonly<Record<string, string | undefined>>
  /** The conversation a message belongs to; the same key as the session's. */
  readonly keyOf: (event: MessageEvent) => string
  /** Only an owner may approve an exec or switch elevated mode. */
  readonly isOwner: (event: MessageEvent) => boolean
  /** Puts a line in the session's chat. */
  readonly send: (event: MessageEvent, text: string) => Promise<void>
  readonly timeoutMs?: number
}

export interface ChatExecApproval {
  readonly hook: GatewayHook
  /** What `startTheoClaw` hands to the exec gate: the chat asker and the elevated waiver. */
  readonly options: Required<Pick<ExecApprovalOptions, 'ask' | 'waived'>>
  /** True while the session of `event` has an exec waiting for its answer. */
  hasPending(event: MessageEvent): boolean
  /** The session's elevated setting. */
  elevated(key: string): boolean
}

function initialElevated(env: ChatExecApprovalOptions['env']): boolean {
  return (env[ELEVATED_VARIABLE] ?? '').trim().toLowerCase() === 'on'
}

/**
 * The chat asker of exec approval (OC-78): the exec's question goes to the chat of the session that
 * ran it, and only `/approve` (or `/approve always`) from an owner there lets it run; `/deny`, or
 * silence for 120 s, refuses it. `/elevated on|off` waives the question for one session only;
 * `THEOCLAW_ELEVATED=on` is the default of sessions that never said.
 */
export function createChatExecApproval(options: ChatExecApprovalOptions): ChatExecApproval {
  const { keyOf, isOwner, send } = options
  const timeoutMs = options.timeoutMs ?? EXEC_APPROVAL_TIMEOUT_MS
  const defaultElevated = initialElevated(options.env)
  const settings = new Map<string, boolean>()
  // Who may answer, the wait and the `/approve` / `/deny` commands are the package's.
  const approver = createChatApprover({
    conversationOf: keyOf,
    isOwner,
    send,
    timeoutMs,
    format: (command, ms) => `Run this command?\n${command}\nReply /approve, /approve always or /deny within ${ms / 1000} s.`,
  })

  const elevated = (key: string): boolean => settings.get(key) ?? defaultElevated

  const ask = async (command: string, call?: { readonly agentId?: string }): Promise<PersonReply> => {
    const key = AGENT_ID.exec(call?.agentId ?? '')?.[1]
    if (key === undefined) return 'deny'
    const reply = await approver.ask(key, command)
    return reply.by === undefined ? reply.answer : { answer: reply.answer, by: reply.by }
  }

  const decide = (event: MessageEvent): HookDecision | undefined => {
    const command = parseChatCommand(event.text)
    if (command?.name !== 'elevated') return undefined
    const key = keyOf(event)
    if (!isOwner(event)) return { block: true, message: 'Only an owner can do that.' }
    const value = command.arg.trim().toLowerCase()
    if (value === 'on' || value === 'off') settings.set(key, value === 'on')
    else if (value !== '') return { block: true, message: 'Use /elevated on or /elevated off.' }
    return { block: true, message: `Elevated mode is ${elevated(key) ? 'on' : 'off'} for this session.` }
  }

  return {
    hook: {
      name: HOOK_NAME,
      // The approver sees every event, so it knows each conversation's latest message to ask in.
      pre_inbound: async (context) => (await approver.hook.pre_inbound?.(context)) ?? decide(context.event),
    },
    options: {
      ask,
      waived: (call) => {
        const key = AGENT_ID.exec(call?.agentId ?? '')?.[1]
        return key === undefined ? defaultElevated : elevated(key)
      },
    },
    hasPending: (event) => approver.hasPending(event),
    elevated,
  }
}
