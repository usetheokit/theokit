import { commandHook, helpText } from '@theokit/gateway'
import { THINKING_LEVELS } from '../agent/create-agent.js'
import { ACP_DESCRIPTION } from './acp-command.js'
import { CHAT_COMMANDS } from './info-commands.js'
import { EXEC_DESCRIPTIONS } from './exec-approval-chat.js'
import { ACTIVATION_DESCRIPTION } from './group-activation-hook.js'
import { USAGE_DESCRIPTION } from './usage-hook.js'
import type { ChatCommand, GatewayHook, HookDecision } from '@theokit/gateway'

type Description = Pick<ChatCommand, 'name' | 'usage' | 'description'>

/** What a chat command's usage line shows beyond `/<name>`: its arguments and the aliases it answers to. */
const USAGES: Readonly<Record<string, string>> = {
  status: '/status, /model',
  think: `/think ${THINKING_LEVELS.join('|')}`,
  steer: '/steer <text>',
}

/** Commands named in another command's usage line (`/model` under `/status`) are not listed twice. */
const aliased = new Set(
  Object.values(USAGES).flatMap(
    (usage) =>
      usage
        .match(/\/\w+/g)
        ?.slice(1)
        .map((w) => w.slice(1)) ?? [],
  ),
)

/**
 * The chat commands WebChat and channels answer, read from `CHAT_COMMANDS` so a command added there
 * is listed with its own description. `/new` and `/goal` are answered inside the reply handler, which
 * defines no command object, so those two stay described here.
 */
const OTHER_DESCRIPTIONS: readonly Description[] = [
  { name: 'new', usage: '/new, /reset', description: 'start a new conversation' },
  { name: 'goal', usage: '/goal <what you want done>', description: 'run a goal to its end' },
  ...CHAT_COMMANDS.filter((command) => !aliased.has(command.name)).map(
    (command): Description => ({
      name: command.name,
      usage: USAGES[command.name] ?? `/${command.name}`,
      description: command.description ?? '',
    }),
  ),
]

/** A command another hook answers: this hook only registers and lists it, then lets the message through. */
const passThrough = (): undefined => undefined

/**
 * Every command `/help` lists, as the gateway registers it. `/help` and the commands of other hooks
 * are all in this one list, so a registered command is always a listed one.
 */
const LISTED: readonly ChatCommand[] = [
  { name: 'help', usage: '/help', description: 'this list', run: (_event, arg) => answer(arg) },
  ...[
    ...OTHER_DESCRIPTIONS,
    USAGE_DESCRIPTION,
    ACTIVATION_DESCRIPTION,
    ...EXEC_DESCRIPTIONS,
    ACP_DESCRIPTION,
  ].map((entry): ChatCommand => ({ ...entry, run: passThrough })),
]

const usageOf = (entry: ChatCommand): string => entry.usage ?? `/${entry.name}`

/** Every command and alias the list names, read from its entries so an added entry is covered. */
export const HELP_COMMANDS: readonly string[] = LISTED.flatMap((entry) =>
  usageOf(entry)
    .split(/[\s,]+/)
    .filter((word) => /^\/\w+$/.test(word)),
)

/** One line per command, in the order the hooks are registered: `<usage> - <description>`. */
export const HELP_TEXT = `Commands answered without the model:\n${helpText(LISTED)}`

/** `/help` and `/commands` alone; with an argument the text is an ordinary message. */
function answer(arg: string): HookDecision | undefined {
  return arg === '' ? { block: true, message: HELP_TEXT } : undefined
}

/** `/help` and `/commands`: one reply listing the chat commands; the message never becomes a prompt. */
export function createHelpHook(): GatewayHook {
  const alias: ChatCommand = {
    name: 'commands',
    description: 'the command list',
    run: (_event, arg) => answer(arg),
  }
  return commandHook([...LISTED, alias], { name: 'theoclaw-help', helpCommand: false })
}
