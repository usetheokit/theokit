import type { GatewayHook } from '@theokit/gateway'

const HELP_COMMAND = /^(?:(?:<@[^>]+>|@\S+)\s+)?\/(?:help|commands)(?:@\S+)?$/

/** The commands a chat answers itself, never passing them to the model (OC-105). */
/** Every command the list names; a test sends each through its real handler. */
export const HELP_COMMANDS = ['/new', '/reset', '/goal', '/usage', '/activation'] as const

export const HELP_TEXT = [
  'Commands answered without the model:',
  '/help - this list',
  '/new, /reset - start a new conversation',
  '/goal <what you want done> - run a goal to its end',
  '/usage off|tokens|cost|full - the usage footer of replies',
  '/activation mention|always - how a group activates the bot (groups only)',
].join('\n')

/** `/help` and `/commands`: one reply listing the chat commands; the message never becomes a prompt. */
export function createHelpHook(): GatewayHook {
  return {
    name: 'theoclaw-help',
    pre_inbound({ event }) {
      return HELP_COMMAND.test(event.text.trim()) ? { block: true, message: HELP_TEXT } : undefined
    },
  }
}
