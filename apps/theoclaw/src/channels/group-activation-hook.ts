import type { GatewayHook, HookDecision, MessageEvent } from '@theokit/gateway'
import { shouldRespondInChat } from '@theokit/gateway-telegram'
import type { Context } from 'grammy'

export type GroupActivationMode = 'mention' | 'always'

export interface GroupActivationOptions {
  /** The policy's owner rule, built in composition: only an owner may change a group's mode. */
  readonly isOwner: (platform: string, senderId: string) => boolean
  /** `THEOCLAW_GROUP_ACTIVATION`, the mode of every group until an owner changes it. */
  readonly mode: GroupActivationMode
  /** Where a context the hook cannot read is reported. Default: standard error. */
  readonly write?: (line: string) => void
}

const HOOK_NAME = 'theoclaw-group-activation'
/**
 * The command, behind an optional leading mention (Slack keeps `<@U…>` in the text, Mattermost and
 * WhatsApp `@name`) and with Telegram's optional `@botname` suffix; the argument is checked apart.
 */
const ACTIVATION = /^(?:(?:<@[^>]+>|@\S+)\s+)?\/activation(?:@\S+)?(?:\s+(.*))?$/
const USAGE = 'Use /activation mention or /activation always.'

/** The grammy context the Telegram adapter carries, with the bot identity grammy sets from `getMe`. */
type TelegramContext = Context & { readonly me: { readonly username: string; readonly id: number } }

function isTelegramContext(raw: unknown): raw is TelegramContext {
  if (typeof raw !== 'object' || raw === null) return false
  const me = (raw as { me?: { username?: unknown; id?: unknown } }).me
  return typeof (raw as { chat?: unknown }).chat === 'object' && typeof me?.username === 'string' && typeof me.id === 'number'
}

function isMode(value: string | undefined): value is GroupActivationMode {
  return value === 'mention' || value === 'always'
}

/**
 * Group activation (FR-007). Slack, Mattermost and WhatsApp gate mentions in their adapters, built
 * from the start-time mode; Telegram is gated here, per group, with `shouldRespondInChat`. Runs after
 * the owner policy hook, so only owners and paired senders reach it, and an owner's
 * `/activation mention|always` changes a Telegram group's mode for the life of the process.
 */
export function createGroupActivationHook(options: GroupActivationOptions): GatewayHook {
  const write = options.write ?? ((line: string) => void process.stderr.write(`${line}\n`))
  const modes = new Map<string, GroupActivationMode>()
  let reportedUnreadable = false

  const activation = (event: MessageEvent, argument: string | undefined): HookDecision => {
    if (event.platform !== 'telegram') {
      return { block: true, message: `Group activation on ${event.platform} is set at start by THEOCLAW_GROUP_ACTIVATION.` }
    }
    const mode = argument?.trim()
    if (!isMode(mode)) return { block: true, message: USAGE }
    modes.set(event.channel.id, mode)
    return { block: true, message: `Group activation is now ${mode}.` }
  }

  /** Whether a Telegram group message is addressed to the bot; an unreadable context is not. */
  const addressed = (event: MessageEvent): boolean => {
    const raw = event.platform === 'telegram' ? event.telegram.raw : undefined
    if (!isTelegramContext(raw)) {
      if (!reportedUnreadable) write(`${HOOK_NAME}: a telegram group message carried no bot identity; treated as unmentioned`)
      reportedUnreadable = true
      return false
    }
    return shouldRespondInChat(raw, { botUsername: raw.me.username, botId: raw.me.id })
  }

  return {
    name: HOOK_NAME,
    pre_inbound({ event }) {
      if (event.channel.type === 'dm') return undefined
      const command = ACTIVATION.exec(event.text.trim())
      if (command !== null) {
        // Only an owner changes a mode; anyone else's command never becomes a prompt either.
        return options.isOwner(event.platform, event.sender.id) ? activation(event, command[1]) : { block: true }
      }
      if (event.platform !== 'telegram') return undefined
      const mode = modes.get(event.channel.id) ?? options.mode
      return mode === 'always' || addressed(event) ? undefined : { block: true }
    },
  }
}
