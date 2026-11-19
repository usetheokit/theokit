import { commandHook, helpText } from '@theokit/gateway'
import { ACP_DESCRIPTION } from './acp-command.js'
import { EXEC_DESCRIPTIONS } from './exec-approval-chat.js'
import { ACTIVATION_DESCRIPTION } from './group-activation-hook.js'
import { USAGE_DESCRIPTION } from './usage-hook.js'
import type { ChatCommand, GatewayHook, HookDecision } from '@theokit/gateway'
/** Every command the list names; a test sends each through its real handler. */

export const HELP_COMMANDS = ['/status', '/model', '/new', '/reset', '/goal', '/steer', '/think', '/compact', '/usage', '/activation', '/approve', '/deny', '/elevated', '/acp'] as const

/** What the list says about a command another hook answers; this one only describes it. */
function described(name: string, usage: string, description: string): ChatCommand {
  return { name, usage, description, run: () => undefined }
}

/**
 * The commands a chat answers itself, never passing them to the model (OC-105). The ones a hook of
 * this folder answers are described by that hook; these are answered by the reply handler and the
 * info hook, which a help list cannot import.
 */
const ELSEWHERE: readonly ChatCommand[] = [
  described('status', '/status, /model', 'the model and surface of this chat'),
  described('new', '/new, /reset', 'start a new conversation'),
  described('goal', '/goal <what you want done>', 'run a goal to its end'),
  described('steer', '/steer <text>', 'redirect the turn that is running'),
  described('think', '/think off|low|medium|high', 'the thinking level of this session (only these four)'),
  described('stop', '/stop', 'stop the turn that is running (WebChat)'),
  described('compact', '/compact', 'summarize the conversation so far to free context (THEOCLAW_COMPACT_AT does it on its own)'),
]

const DESCRIBED: readonly ChatCommand[] = [
  described('help', '/help', 'this list'),
  ...ELSEWHERE,
  ...[USAGE_DESCRIPTION, ACTIVATION_DESCRIPTION, ...EXEC_DESCRIPTIONS, ACP_DESCRIPTION].map((entry) =>
    described(entry.name, entry.usage ?? `/${entry.name}`, entry.description),
  ),
]

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
