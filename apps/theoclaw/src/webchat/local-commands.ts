
import { createCommandRegistry, type CommandDefinition } from '@theokit/agents/commands'

import { CHAT_COMMANDS, infoReply } from '../channels/info-commands.js'
import { THINKING_LEVELS, type ThinkingLevel } from '../agent/create-agent.js'
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

/** What one local command writes its reply to: the message it answers and, once run, the reply. */
interface Exchange {
  readonly message: string
  reply?: string
}

/**
 * WebChat's commands in one registry, the definitions of `CHAT_COMMANDS` with a handler each. A
 * command whose member is absent is left out, so it is an ordinary message; `/model <id>` answers
 * with the refusal of `infoReply`, it never switches the model.
 */
function localCommands(context: LocalCommandContext) {
  const info = (_arg: string, x: Exchange): void => {
    x.reply = infoReply(x.message, context.model, 'webchat', [
      `Thinking: ${context.thinking?.() ?? 'default'}`,
      `Running turns: ${String(context.running())}`,
    ])
  }
  const { think, compact, steer } = context
  const handlers: Readonly<
    Record<
      string,
      {
        readonly present: boolean
        readonly run: (arg: string, x: Exchange) => void | Promise<void>
      }
    >
  > = {
    status: { present: true, run: info },
    model: { present: true, run: info },
    think: {
      present: think !== undefined,
      run: (arg, x) => {
        const level = arg.toLowerCase()
        if (!(THINKING_LEVELS as readonly string[]).includes(level)) {
          x.reply = `Usage: /think ${THINKING_LEVELS.join('|')} (only these four levels)`
          return
        }
        think?.(level as ThinkingLevel)
        x.reply = `Thinking level set to ${level}.`
      },
    },
    compact: {
      present: compact !== undefined,
      run: async (_arg, x) => void (x.reply = await compact?.()),
    },
    stop: {
      present: true,
      run: (_arg, x) => {
        const stopped = context.stop()
        x.reply =
          stopped === 0
            ? 'Nothing is running to stop.'
            : `Stopped ${String(stopped)} running turn${stopped === 1 ? '' : 's'}.`
      },
    },
    steer: {
      present: steer !== undefined,
      run: async (arg, x) => void (x.reply = arg === '' ? STEER_USAGE_REPLY : await steer?.(arg)),
    },
  }
  return createCommandRegistry<Exchange>(
    CHAT_COMMANDS.flatMap((definition) => {
      const handler = handlers[definition.name]
      return handler?.present === true
        ? [{ ...definition, run: handler.run } as CommandDefinition<Exchange>]
        : []
    }),
  )
}

/**
 * A runner that answers WebChat's slash commands itself (OC-105): no model turn, and no usage in
 * the outcome, so no usage line. Any other text goes to `runner`.
 */
export function withLocalCommands(runner: TurnRunner, context: LocalCommandContext): TurnRunner {
  const registry = localCommands(context)
  return async (message, emit, signal) => {
    const exchange: Exchange = { message }
    // A Telegram `/model@bot` names the same command.
    await registry.dispatch(message.trim().replace(/^(\/\w+)@\S+/, '$1'), exchange)
    const reply = exchange.reply
    if (reply === undefined) return runner(message, emit, signal)
    emit({ type: 'text_delta', content: reply })
    emit({ type: 'done', result: reply, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, durationMs: 0 })
    return { ok: true }
  }
}
