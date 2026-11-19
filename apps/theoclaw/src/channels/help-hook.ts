import { commandHook, helpText } from '@theokit/gateway'
import { THINKING_LEVELS } from '../agent/failover.js'
import { ACP_DESCRIPTION } from './acp-command.js'
import { EXEC_DESCRIPTIONS } from './exec-approval-chat.js'
import { ACTIVATION_DESCRIPTION } from './group-activation-hook.js'
import { USAGE_DESCRIPTION } from './usage-hook.js'
import type { ChatCommand, GatewayHook, HookDecision } from '@theokit/gateway'

/** What the list says about a command another hook answers; this one only describes it. */
function described(name: string, usage: string, description: string): ChatCommand {
  return { name, usage, description, run: () => undefined }
}

/** The commands whose handlers live in files this list does not own: what each says about itself. */
const OTHER_DESCRIPTIONS: readonly Pick<ChatCommand, 'name' | 'usage' | 'description'>[] = [
  { name: 'status', usage: '/status, /model', description: 'the model and surface of this chat' },
  { name: 'new', usage: '/new, /reset', description: 'start a new conversation' },
  { name: 'goal', usage: '/goal <what you want done>', description: 'run a goal to its end' },
  { name: 'steer', usage: '/steer <text>', description: 'redirect the turn that is running' },
  { name: 'think', usage: `/think ${THINKING_LEVELS.join('|')}`, description: 'the thinking level of this session (only these four)' },
  { name: 'stop', usage: '/stop', description: 'stop the turn that is running (WebChat)' },
  { name: 'compact', usage: '/compact', description: 'summarize the conversation so far to free context (THEOCLAW_COMPACT_AT does it on its own)' },
]

const DESCRIBED: readonly ChatCommand[] = [
  described('help', '/help', 'this list'),
  ...[
    ...OTHER_DESCRIPTIONS,
    USAGE_DESCRIPTION,
    ACTIVATION_DESCRIPTION,
    ...EXEC_DESCRIPTIONS,
    ACP_DESCRIPTION,
  ].map((entry) =>
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
