import { commandHook, helpText } from '@theokit/gateway'
import { COMPACT_DESCRIPTION } from './compact-command.js'
import { GOAL_DESCRIPTION } from './goal-command.js'
import { INFO_DESCRIPTION } from './info-commands.js'
import { REPLY_DESCRIPTIONS } from './reply-handler.js'
import { STOP_DESCRIPTION } from '../webchat/local-commands.js'
import { ACP_DESCRIPTION } from './acp-command.js'
import { EXEC_DESCRIPTIONS } from './exec-approval-chat.js'
import { ACTIVATION_DESCRIPTION } from './group-activation-hook.js'
import { USAGE_DESCRIPTION } from './usage-hook.js'
import type { ChatCommand, GatewayHook, HookDecision } from '@theokit/gateway'

/** What the list says about a command another hook answers; this one only describes it. */
function described(name: string, usage: string, description: string): ChatCommand {
  return { name, usage, description, run: () => undefined }
}

const DESCRIBED: readonly ChatCommand[] = [
  described('help', '/help', 'this list'),
  ...[
    INFO_DESCRIPTION,
    ...REPLY_DESCRIPTIONS,
    GOAL_DESCRIPTION,
    STOP_DESCRIPTION,
    COMPACT_DESCRIPTION,
    USAGE_DESCRIPTION,
    ACTIVATION_DESCRIPTION,
    ...EXEC_DESCRIPTIONS,
    ACP_DESCRIPTION,
  ].map((entry) =>
    described(entry.name, entry.usage ?? `/${entry.name}`, entry.description),
  ),
]

/** Every command the list names, read from the descriptions that make the text. */
export const HELP_COMMANDS: readonly string[] = DESCRIBED.filter((c) => c.name !== 'help').map((c) => `/${c.name}`)

export const HELP_TEXT = `Commands answered without the model:\n${helpText(DESCRIBED)}`

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
