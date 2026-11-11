import { commandOf, CHAT_COMMANDS, infoReply } from '../channels/info-commands.js'
import { THINKING_LEVELS, type ThinkingLevel } from '../agent/failover.js'
import { STEER_USAGE_REPLY } from '../channels/reply-handler.js'
import type { TurnRunner } from '../control-plane/turn.js'

/** What WebChat's own commands act on, for one chat. Absent members make that command an ordinary message. */
export interface LocalCommandContext {
  readonly model: string | undefined
  /** `/think <level>`: sets the chat's thinking level. */
  readonly think?: (level: ThinkingLevel) => void
  /** The thinking level `/think` set, shown by `/status`. */
  readonly thinking?: () => ThinkingLevel | undefined
  /** `/compact`: the one-line result. */
  readonly compact?: () => Promise<string>
  /** `/steer <text>`: injects into the running turn; the reply says whether there was one. */
  readonly steer?: (note: string) => Promise<string>
  /** How many turns of this chat run now. */
  readonly running: () => number
  /** `/stop`: cancels this chat's running turns; returns how many. */
  readonly stop: () => number
}

async function answer(message: string, context: LocalCommandContext): Promise<string | undefined> {
  const command = commandOf(message, CHAT_COMMANDS)
  if (command === undefined) return undefined
  const { arg } = command
  switch (command.name) {
    case 'think': {
      const level = arg.toLowerCase()
      if (context.think === undefined) return undefined
      if (!(THINKING_LEVELS as readonly string[]).includes(level)) return `Usage: /think ${THINKING_LEVELS.join('|')} (only these four levels)`
      context.think(level as ThinkingLevel)
      return `Thinking level set to ${level}.`
    }
    case 'compact':
      return context.compact?.()
    case 'steer':
      if (context.steer === undefined) return undefined
      return arg === '' ? STEER_USAGE_REPLY : context.steer(arg)
    case 'stop': {
      const stopped = context.stop()
      return stopped === 0 ? 'Nothing is running to stop.' : `Stopped ${String(stopped)} running turn${stopped === 1 ? '' : 's'}.`
    }
    default:
      return infoReply(message, context.model, 'webchat', [`Thinking: ${context.thinking?.() ?? 'default'}`, `Running turns: ${String(context.running())}`])
  }
}

/**
 * A runner that answers WebChat's slash commands itself (OC-105): no model turn, and no usage in
 * the outcome, so no usage line. Any other text goes to `runner`.
 */
export function withLocalCommands(runner: TurnRunner, context: LocalCommandContext): TurnRunner {
  return async (message, emit, signal) => {
    const reply = await answer(message, context)
    if (reply === undefined) return runner(message, emit, signal)
    emit({ type: 'text_delta', content: reply })
    emit({ type: 'done' })
    return { ok: true }
  }
}
