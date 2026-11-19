import { type CommandDefinition, defineCommand, routeCommand } from '@theokit/agents/commands'
import type { GatewayHook } from '@theokit/gateway'

/** The commands answered from what the process knows, never by the model (OC-105), routed by the agents command router. */
export const INFO_COMMANDS = [
  defineCommand({ name: 'status', description: 'the model and surface of this chat' }),
  defineCommand({ name: 'model', description: 'the model this chat runs' }),
]

/** Every chat command WebChat answers itself; the first two are also answered on channels. */
export const CHAT_COMMANDS = [
  ...INFO_COMMANDS,
  defineCommand({ name: 'think', description: 'the thinking level of this session' }),
  defineCommand({ name: 'compact', description: 'summarize the conversation so far' }),
  defineCommand({ name: 'stop', description: 'stop the turn that is running', arg: 'none' }),
  defineCommand({ name: 'steer', description: 'redirect the turn that is running' }),
]

/** The command a message names (a Telegram `/model@bot` accepted) and its argument; `undefined` for any other text. */
export function commandOf(text: string, commands: readonly CommandDefinition[]): { readonly name: string; readonly arg: string } | undefined {
  const routed = routeCommand(text.trim().replace(/^(\/\w+)@\S+/, '$1'), commands)
  return routed.kind === 'command' ? { name: routed.command.name, arg: routed.arg } : undefined
}

/**
 * The reply to `/status` or `/model`, or `undefined` for any other text, which goes on to the
 * other hooks and the model. `details` are extra `/status` lines (a session's thinking level, turns running).
 */
export function infoReply(text: string, model: string | undefined, surface: string, details: readonly string[] = []): string | undefined {
  const command = commandOf(text, INFO_COMMANDS)
  if (command === undefined) return undefined
  const current = model ?? 'not configured'
  if (command.name === 'model') {
    return command.arg === '' ? `Model: ${current}` : `Model: ${current} (switching the model from a chat is not supported)`
  }
  return ['TheoClaw status:', `Model: ${current}`, `Surface: ${surface}`, ...details].join('\n')
}

/** `/status` and `/model` on a channel: one reply, the message never becomes a prompt. */
export function createInfoHook(model: string | undefined): GatewayHook {
  return {
    name: 'theoclaw-status',
    pre_inbound({ event }) {
      const reply = infoReply(event.text, model, event.platform)
      return reply === undefined ? undefined : { block: true, message: reply }
    },
  }
}
