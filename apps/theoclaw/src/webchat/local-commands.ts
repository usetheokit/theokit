import type { TurnRunner } from '../control-plane/turn.js'

const MODEL_COMMAND = /^\/model$/i
const STATUS_COMMAND = /^\/status$/i

/** The reply of a WebChat slash command answered without the model (OC-105), or `undefined` for an ordinary message. */
export function localReply(message: string, model: string | undefined): string | undefined {
  const text = message.trim()
  if (MODEL_COMMAND.test(text)) return model === undefined ? 'No model is configured.' : `Model: ${model}`
  if (STATUS_COMMAND.test(text)) return ['TheoClaw status:', `Model: ${model ?? 'not configured'}`, 'Channel: webchat'].join('\n')
  return undefined
}

/** A runner that answers `/model` and `/status` itself: no model turn, no usage in the outcome. */
export function withLocalCommands(runner: TurnRunner, model: string | undefined): TurnRunner {
  return async (message, emit, signal) => {
    const reply = localReply(message, model)
    if (reply === undefined) return runner(message, emit, signal)
    emit({ type: 'text_delta', content: reply } as Parameters<typeof emit>[0])
    emit({ type: 'done' } as Parameters<typeof emit>[0])
    return { ok: true }
  }
}
