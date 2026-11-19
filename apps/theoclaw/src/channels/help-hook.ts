import { commandHook } from '@theokit/gateway'
import { ACP_DESCRIPTION } from './acp-command.js'
import { COMPACT_DESCRIPTION } from './compact-command.js'
import { EXEC_DESCRIPTIONS } from './exec-approval-chat.js'
import { ACTIVATION_DESCRIPTION } from './group-activation-hook.js'
import { GOAL_DESCRIPTION } from './goal-command.js'
import { STATUS_DESCRIPTION, STEER_DESCRIPTION, STOP_DESCRIPTION, THINK_DESCRIPTION } from './info-commands.js'
import { RESET_DESCRIPTION } from './reply-handler.js'
import { USAGE_DESCRIPTION } from './usage-hook.js'
import type { ChatCommand, GatewayHook, HookDecision } from '@theokit/gateway'

export type CommandDescription = Pick<ChatCommand, 'name' | 'usage' | 'description'>

/** What `/help` says about itself; every other line comes from the description its own hook exports. */
const HELP_DESCRIPTION: CommandDescription = {
  name: 'help',
  usage: '/help',
  description: 'this list',
}

/** Every command line `/help` lists; each entry is exported by the file whose handler answers it. */
export const HELP_ENTRIES: readonly CommandDescription[] = [
  HELP_DESCRIPTION,
  STATUS_DESCRIPTION,
  RESET_DESCRIPTION,
  GOAL_DESCRIPTION,
  STEER_DESCRIPTION,
  THINK_DESCRIPTION,
  STOP_DESCRIPTION,
  COMPACT_DESCRIPTION,
  USAGE_DESCRIPTION,
  ACTIVATION_DESCRIPTION,
  ...EXEC_DESCRIPTIONS,
  ACP_DESCRIPTION,
]

const usageOf = (entry: CommandDescription): string => entry.usage ?? `/${entry.name}`

/** Every command and alias the list names, read from its entries so an added entry is covered. */
export const HELP_COMMANDS: readonly string[] = HELP_ENTRIES.flatMap((entry) =>
  usageOf(entry)
    .split(/[\s,]+/)
    .filter((word) => /^\/\w+$/.test(word)),
)

/** One line per command, in the order the hooks are registered: `<usage> - <description>`. */
export const HELP_TEXT = `Commands answered without the model:\n${HELP_ENTRIES.map((entry) => `${usageOf(entry)} - ${entry.description}`).join('\n')}`

/** `/help` and `/commands` alone; with an argument the text is an ordinary message. */
const answer = (_event: unknown, arg: string): HookDecision | undefined =>
  arg === '' ? { block: true, message: HELP_TEXT } : undefined

/** `/help` and `/commands`: one reply listing the chat commands; the message never becomes a prompt. */
export function createHelpHook(): GatewayHook {
  return commandHook(
    ['help', 'commands'].map((name) => ({ name, description: 'the command list', run: answer })),
    { name: 'theoclaw-help', helpCommand: false },
  )
}
