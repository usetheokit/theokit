import { parseChatCommand } from '@theokit/gateway'
import type { ChatCommand, GatewayHook } from '@theokit/gateway'

export interface GroupActivationOptions {
  /** The policy's owner rule, built in composition: only an owner may change a group's mode. */
  readonly isOwner: (platform: string, senderId: string) => boolean
}

const HOOK_NAME = 'theoclaw-group-activation'
/** What `/help` says about the command this hook answers. */
export const ACTIVATION_DESCRIPTION: Pick<ChatCommand, 'name' | 'usage' | 'description'> = {
  name: 'activation',
  usage: '/activation mention|always',
  description: 'how a group activates the bot (groups only)',
}

/**
 * Group activation (FR-007). Telegram, Slack, Mattermost and WhatsApp gate mentions in their
 * adapters, built from the start-time mode (`THEOCLAW_GROUP_ACTIVATION`); this hook answers the
 * `/activation` command, which cannot change that. It runs after the owner policy hook, so only
 * owners and paired senders reach it; a sender who is no owner gets silence, and the command never
 * becomes a prompt.
 */
export function createGroupActivationHook(options: GroupActivationOptions): GatewayHook {
  return {
    name: HOOK_NAME,
    pre_inbound({ event }) {
      if (event.channel.type === 'dm') return undefined
      const command = parseChatCommand(event.text)
      if (command?.name !== 'activation') return undefined
      if (!options.isOwner(event.platform, event.sender.id)) return { block: true }
      return { block: true, message: `Group activation on ${event.platform} is set at start by THEOCLAW_GROUP_ACTIVATION.` }
    },
  }
}
