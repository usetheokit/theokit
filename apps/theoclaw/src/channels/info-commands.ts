import { defineCommand, routeCommand } from '@theokit/agents/commands'
import type { GatewayHook } from '@theokit/gateway'

/** The commands answered from what the process knows, never by the model (OC-105), routed by the agents command router. */
export const INFO_COMMANDS = [
  defineCommand({ name: 'status', description: 'the model and surface of this chat' }),
  defineCommand({ name: 'model', description: 'the model this chat runs' }),
]

/**
 * The reply to `/status` or `/model` (a Telegram `/model@bot` and trailing words are accepted), or
 * `undefined` for any other text, which goes on to the other hooks and the model.
 */
export function infoReply(
  text: string,
  model: string | undefined,
  surface: string,
): string | undefined {
  const routed = routeCommand(text.trim().replace(/^(\/\w+)@\S+/, '$1'), INFO_COMMANDS)
  if (routed.kind !== 'command') return undefined
  const current = model ?? 'not configured'
  if (routed.command.name === 'model') {
    return routed.arg === ''
      ? `Model: ${current}`
      : `Model: ${current} (switching the model from a chat is not supported)`
  }
  return ['TheoClaw status:', `Model: ${current}`, `Surface: ${surface}`].join('\n')
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
