import { infoReply } from '../channels/info-commands.js'
import type { TurnRunner } from '../control-plane/turn.js'

/** A runner that answers `/model` and `/status` itself: no model turn, and no usage in the outcome. */
export function withLocalCommands(runner: TurnRunner, model: string | undefined): TurnRunner {
  return async (message, emit, signal) => {
    const reply = infoReply(message, model, 'webchat')
    if (reply === undefined) return runner(message, emit, signal)
    emit({ type: 'text_delta', content: reply })
    emit({ type: 'done' })
    return { ok: true }
  }
}
