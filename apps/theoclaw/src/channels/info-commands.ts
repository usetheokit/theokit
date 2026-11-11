import type { GatewayHook } from '@theokit/gateway'

import type { TurnEvent, TurnRunner } from '../control-plane/turn.js'

/** `/model` and `/status`, behind an optional leading mention and Telegram's optional `@botname`. */
const INFO_COMMAND = /^(?:(?:<@[^>]+>|@\S+)\s+)?\/(model|status)(?:@\S+)?$/

export interface InfoCommandSettings {
  /** The model TheoClaw runs (`THEOCLAW_MODEL`). */
  readonly model: string
}

/** The answer to `/model` or `/status`, or undefined when the text is neither. Never a model turn. */
export function infoCommandReply(text: string, settings: InfoCommandSettings): string | undefined {
  const match = INFO_COMMAND.exec(text.trim())
  if (match === null) return undefined
  if (match[1] === 'model') return `Model: ${settings.model}`
  return ['TheoClaw is running.', `Model: ${settings.model}`, `Uptime: ${String(Math.round(process.uptime()))}s`].join('\n')
}

/** The channels' side of `/model` and `/status` (OC-105). */
export function createInfoCommandHook(settings: InfoCommandSettings): GatewayHook {
  return {
    name: 'theoclaw-info-commands',
    pre_inbound({ event }) {
      const message = infoCommandReply(event.text, settings)
      return message === undefined ? undefined : { block: true, message }
    },
  }
}

/** WebChat's side: answers the commands as a finished turn with no usage, and runs any other message on `inner`. */
export function withInfoCommands(inner: TurnRunner, settings: InfoCommandSettings): TurnRunner {
  return async (message, emit, signal) => {
    const reply = infoCommandReply(message, settings)
    if (reply === undefined) return inner(message, emit, signal)
    emit({ type: 'text_delta', content: reply } as TurnEvent)
    emit({ type: 'done' } as TurnEvent)
    return { ok: true }
  }
}
