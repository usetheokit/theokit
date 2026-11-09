import type { GatewayHook, HookDecision, MessageEvent } from '@theokit/gateway'

import { sessionKeyFor } from '../sessions/session-key.js'
import type { UsageFooterMode } from '../usage/turn-usage.js'

/** A conversation's `/usage` setting; `off`, the default, adds no footer. */
export type UsageMode = 'off' | UsageFooterMode

export interface UsageHookOptions {
  /** The conversation a message belongs to: the session key the router derives. Default: per channel and peer. */
  readonly keyOf?: (event: MessageEvent) => string
}

export interface UsageHook {
  readonly hook: GatewayHook
  /** The mode of the event's conversation, read when its reply is sent (EC-7). */
  modeFor(event: MessageEvent): UsageMode
}

const HOOK_NAME = 'theoclaw-usage'
/** Behind an optional leading mention and with Telegram's optional `@botname`, as `/activation`. */
const USAGE_COMMAND = /^(?:(?:<@[^>]+>|@\S+)\s+)?\/usage(?:@\S+)?(?:\s+(.*))?$/
const USAGE_TEXT = 'Use /usage off, /usage tokens, /usage cost or /usage full.'
const MODES: ReadonlySet<string> = new Set<UsageMode>(['off', 'tokens', 'cost', 'full'])

function isMode(value: string | undefined): value is UsageMode {
  return value !== undefined && MODES.has(value)
}

const defaultKey = (event: MessageEvent): string =>
  sessionKeyFor(event, { dmScope: 'per-channel-peer', peerLinks: new Map() })

/**
 * `/usage off|tokens|full|cost` (OC-97, FR-005, plan D2). Runs after the owner policy, so only
 * owners and paired senders reach it, and a command never becomes a prompt (NFR-005). The mode is
 * kept per conversation for the life of the process; a restart resets every conversation to `off`.
 */
export function createUsageHook(options: UsageHookOptions = {}): UsageHook {
  const keyOf = options.keyOf ?? defaultKey
  const modes = new Map<string, UsageMode>()
  const answer = (event: MessageEvent, argument: string | undefined): HookDecision => {
    const mode = argument?.trim()
    if (!isMode(mode)) return { block: true, message: USAGE_TEXT }
    if (mode === 'off') modes.delete(keyOf(event))
    else modes.set(keyOf(event), mode)
    return { block: true, message: `Usage footer is now ${mode}.` }
  }
  return {
    hook: {
      name: HOOK_NAME,
      pre_inbound({ event }) {
        const command = USAGE_COMMAND.exec(event.text.trim())
        return command === null ? undefined : answer(event, command[1])
      },
    },
    modeFor: (event) => modes.get(keyOf(event)) ?? 'off',
  }
}
