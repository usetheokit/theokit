import type { GatewayHook, HookDecision, MessageEvent } from '@theokit/gateway'

import type { ExecApprovalOptions, PersonReply } from '../tools/exec-approval.js'

/** The variable that sets the default of `/elevated`: `on` waives the exec question for every session. */
export const ELEVATED_VARIABLE = 'THEOCLAW_ELEVATED'
/** How long an exec waits for `/approve` or `/deny` before it is refused (B-572). */
export const EXEC_APPROVAL_TIMEOUT_MS = 120_000

const HOOK_NAME = 'theoclaw-exec-approval-chat'
const MENTION = '(?:(?:<@[^>]+>|@\\S+)\\s+)?'
const APPROVE_COMMAND = new RegExp(`^${MENTION}/approve(?:@\\S+)?(?:\\s+(always))?$`)
const DENY_COMMAND = new RegExp(`^${MENTION}/deny(?:@\\S+)?$`)
const ELEVATED_COMMAND = new RegExp(`^${MENTION}/elevated(?:@\\S+)?(?:\\s+(.*))?$`)
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

interface Pending {
  readonly answer: (answer: PersonReply) => void
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
  const latest = new Map<string, MessageEvent>()
  const pending = new Map<string, Pending>()

  const elevated = (key: string): boolean => settings.get(key) ?? defaultElevated

  const ask = async (
    command: string,
    call?: { readonly agentId?: string },
  ): Promise<PersonReply> => {
    const key = AGENT_ID.exec(call?.agentId ?? '')?.[1]
    const event = key === undefined ? undefined : latest.get(key)
    if (key === undefined || event === undefined || pending.has(key)) return 'deny'
    let timer: NodeJS.Timeout | undefined
    const answered = new Promise<PersonReply>((resolve) => {
      pending.set(key, { answer: resolve })
      timer = setTimeout(() => resolve('deny'), timeoutMs)
    })
    try {
      await send(
        event,
        `Run this command?\n${command}\nReply /approve, /approve always or /deny within ${timeoutMs / 1000} s.`,
      )
    } catch {
      pending.delete(key)
      clearTimeout(timer)
      return 'deny'
    }
    try {
      return await answered
    } finally {
      pending.delete(key)
      clearTimeout(timer)
    }
  }

  const decide = (event: MessageEvent): HookDecision | undefined => {
    const text = event.text.trim()
    const key = keyOf(event)
    latest.set(key, event)
    const approve = APPROVE_COMMAND.exec(text)
    const deny = DENY_COMMAND.test(text)
    const elevate = ELEVATED_COMMAND.exec(text)
    if (approve === null && !deny && elevate === null) return undefined
    if (!isOwner(event)) return { block: true, message: 'Only an owner can do that.' }
    if (elevate !== null) {
      const value = (elevate[1] ?? '').trim().toLowerCase()
      if (value === 'on' || value === 'off') settings.set(key, value === 'on')
      else if (value !== '') return { block: true, message: 'Use /elevated on or /elevated off.' }
      return {
        block: true,
        message: `Elevated mode is ${elevated(key) ? 'on' : 'off'} for this session.`,
      }
    }
    const waiting = pending.get(key)
    if (waiting === undefined) return { block: true, message: 'Nothing is waiting for approval.' }
    waiting.answer({ answer: deny ? 'deny' : approve?.[1] === 'always' ? 'always' : 'once', by: `${event.platform}:${event.sender.id}` })
    return { block: true, message: deny ? 'Denied.' : 'Approved.' }
  }

  return {
    hook: { name: HOOK_NAME, pre_inbound: ({ event }) => decide(event) },
    options: {
      ask,
      waived: (call) => {
        const key = AGENT_ID.exec(call?.agentId ?? '')?.[1]
        return key === undefined ? defaultElevated : elevated(key)
      },
    },
    hasPending: (event) => pending.has(keyOf(event)),
    elevated,
  }
}
