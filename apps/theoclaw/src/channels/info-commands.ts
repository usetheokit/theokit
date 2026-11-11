import type { GatewayHook } from '@theokit/gateway'

import type { TurnEvent, TurnRunner } from '../control-plane/turn.js'

/** `/model`, `/status` and `/think`, behind an optional leading mention and Telegram's optional `@botname`. */
const INFO_COMMAND = /^(?:(?:<@[^>]+>|@\S+)\s+)?\/(model|status|think)(?:@\S+)?(?:\s+[\s\S]*)?$/

export interface InfoCommandSettings {
  /** The model TheoClaw runs (`THEOCLAW_MODEL`). */
  readonly model: string
  /** `THEOCLAW_THINKING`; absent: the model's default. */
  readonly thinking?: string
}

/** The answer to `/model`, `/status` or `/think`, or undefined for other text. Never a model turn. */
export function infoCommandReply(text: string, settings: InfoCommandSettings): string | undefined {
  const match = INFO_COMMAND.exec(text.trim())
  if (match === null) return undefined
  const thinking = settings.thinking ?? 'model default'
  if (match[1] === 'model') return text.trim().split(/\s+/).length > 1 ? `Model: ${settings.model} (it is set with THEOCLAW_MODEL when TheoClaw starts)` : `Model: ${settings.model}`
  if (match[1] === 'think') return `Thinking: ${thinking} (it is set with THEOCLAW_THINKING when TheoClaw starts)`
  return ['TheoClaw is running.', `Model: ${settings.model}`, `Thinking: ${thinking}`, `Uptime: ${String(Math.round(process.uptime()))}s`].join('\n')
}

/** The channels' side of `/model`, `/status` and `/think` (OC-105). */
export function createInfoCommandHook(settings: InfoCommandSettings): GatewayHook {
  return {
    name: 'theoclaw-info-commands',
    pre_inbound({ event }) {
      const message = infoCommandReply(event.text, settings)
      return message === undefined ? undefined : { block: true, message }
    },
  }
}

/** What WebChat answers to `/help` or `/commands`: only the commands WebChat answers itself. */
export const WEBCHAT_HELP_TEXT = [
  'Commands answered without the model:',
  '/help - this list',
  '/model - the model in use',
  '/status - whether TheoClaw is up, its model and uptime',
  '/think - the thinking level in use',
  '/compact - summarize the conversation so far to free context',
  '/stop - stop the turn this chat is running',
  '/steer <message> - stop the running turn and send the message as the next one',
].join('\n')

/** The chats' running turns, so `/stop` and `/steer` reach a turn another request started. */
export type ActiveTurns = Map<string, Set<AbortController>>

export interface WebchatCommandSettings extends InfoCommandSettings {
  readonly chatId: string
  readonly active: ActiveTurns
  /** Compacts this chat's session and says so in one line. */
  readonly compact: () => Promise<string>
}

const WEBCHAT_COMMAND = /^\/(help|commands|compact|stop|steer)(?:\s+([\s\S]*))?$/

function stopAll(active: ActiveTurns, chatId: string): number {
  const running = [...(active.get(chatId) ?? [])]
  for (const controller of running) controller.abort()
  return running.length
}

/**
 * WebChat's slash commands (OC-105): answered as a finished turn with no usage, never a model turn.
 * Any other message runs on `inner`, tracked so `/stop` and `/steer` can cancel it.
 */
export function withWebchatCommands(inner: TurnRunner, settings: WebchatCommandSettings): TurnRunner {
  const { chatId, active } = settings
  const track = async (message: string, emit: (event: TurnEvent) => void, signal?: AbortSignal) => {
    const controller = new AbortController()
    const relay = (): void => controller.abort()
    if (signal?.aborted === true) relay()
    else signal?.addEventListener('abort', relay, { once: true })
    const set = active.get(chatId) ?? new Set<AbortController>()
    set.add(controller)
    active.set(chatId, set)
    try {
      return await inner(message, emit, controller.signal)
    } finally {
      signal?.removeEventListener('abort', relay)
      set.delete(controller)
      if (set.size === 0) active.delete(chatId)
    }
  }
  const answer = (reply: string, emit: (event: TurnEvent) => void) => {
    emit({ type: 'text_delta', content: reply } as TurnEvent)
    emit({ type: 'done' } as TurnEvent)
    return { ok: true } as const
  }
  return async (message, emit, signal) => {
    const text = message.trim()
    const info = infoCommandReply(text, settings)
    if (info !== undefined) return answer(info, emit)
    const command = WEBCHAT_COMMAND.exec(text)
    if (command === null) return track(message, emit, signal)
    const argument = (command[2] ?? '').trim()
    switch (command[1]) {
      case 'compact':
        return answer(await settings.compact(), emit)
      case 'stop':
        return answer(stopAll(active, chatId) > 0 ? 'Stopped.' : 'Nothing is running.', emit)
      case 'steer':
        if (argument === '') return answer('Use /steer <message>.', emit)
        stopAll(active, chatId)
        return track(argument, emit, signal)
      default:
        return answer(WEBCHAT_HELP_TEXT, emit)
    }
  }
}
