import { commandHook, helpText } from '@theokit/gateway'
import { THINKING_LEVELS } from '../agent/failover.js'
import { ACP_DESCRIPTION } from './acp-command.js'
import { EXEC_DESCRIPTIONS } from './exec-approval-chat.js'
import { ACTIVATION_DESCRIPTION } from './group-activation-hook.js'
import { USAGE_DESCRIPTION } from './usage-hook.js'
import type { ChatCommand, GatewayHook, HookDecision } from '@theokit/gateway'

type Description = Pick<ChatCommand, 'name' | 'usage' | 'description'>

/** The commands answered by hooks and handlers in files this list does not own: what each says about itself. */
const OTHER_DESCRIPTIONS: readonly Description[] = [
  { name: 'status', usage: '/status, /model', description: 'the model and surface of this chat' },
  { name: 'new', usage: '/new, /reset', description: 'start a new conversation' },
  { name: 'goal', usage: '/goal <what you want done>', description: 'run a goal to its end' },
  { name: 'steer', usage: '/steer <text>', description: 'redirect the turn that is running' },
  {
    name: 'think',
    usage: `/think ${THINKING_LEVELS.join('|')}`,
    description: 'the thinking level of this session (only these four)',
  },
  { name: 'stop', usage: '/stop', description: 'stop the turn that is running (WebChat)' },
  {
    name: 'compact',
    usage: '/compact',
    description:
      'summarize the conversation so far to free context (THEOCLAW_COMPACT_AT does it on its own)',
  },
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
