import type { ThinkingLevel } from '../agent/failover.js'
import { untrustedContentSendOptions } from '../agent/untrusted-content.js'
import { type CompactSettings, runCompact } from '../channels/compact-command.js'
import { STEER_IDLE_REPLY, STEERED_REPLY } from '../channels/reply-handler.js'
import type { TurnRunner } from '../control-plane/turn.js'
import type { ChatBoundary } from '../sessions/chat-sessions.js'
import { webchatEvent } from './chat-id.js'
import { withLocalCommands } from './local-commands.js'

export interface WebchatCommandOptions {
  readonly model: string
  /** The chat's model turn: a runner over its session agent. */
  readonly runnerFor: (chatId: string) => TurnRunner
  readonly withChatAgent: ChatBoundary
  /** Sets the session's thinking level (`SessionAgents.think` of the chat path). */
  readonly think: (event: ReturnType<typeof webchatEvent>, level: ThinkingLevel) => void
  readonly compact: CompactSettings
}

/**
 * The WebChat turn runner of each chat id with `/status`, `/model`, `/think`, `/compact`, `/stop`
 * and `/steer` answered without a model turn (OC-105). The turns running and the thinking level are
 * kept per chat for the life of the process.
 */
export function webchatTurnFor(options: WebchatCommandOptions): (chatId: string) => TurnRunner {
  const running = new Map<string, Set<AbortController>>()
  const thinking = new Map<string, ThinkingLevel>()
  const turnsOf = (chatId: string): Set<AbortController> => {
    const known = running.get(chatId)
    if (known !== undefined) return known
    const created = new Set<AbortController>()
    running.set(chatId, created)
    return created
  }
  return (chatId) => {
    const event = webchatEvent(chatId)
    const base = options.runnerFor(chatId)
    // Every model turn can be stopped by `/stop`, as well as by its own request leaving.
    const tracked: TurnRunner = async (message, emit, signal) => {
      const own = new AbortController()
      const stopOwn = (): void => own.abort()
      if (signal?.aborted === true) stopOwn()
      else signal?.addEventListener('abort', stopOwn, { once: true })
      turnsOf(chatId).add(own)
      try {
        return await base(message, emit, own.signal)
      } finally {
        signal?.removeEventListener('abort', stopOwn)
        turnsOf(chatId).delete(own)
      }
    }
    return withLocalCommands(tracked, {
      model: options.model,
      think: (level) => {
        thinking.set(chatId, level)
        options.think(event, level)
      },
      thinking: () => thinking.get(chatId),
      compact: () => options.withChatAgent(event, (lease) => runCompact(options.compact, lease.agentId).finally(() => lease.release())),
      steer: (note) =>
        options.withChatAgent(event, async (lease) => {
          try {
            if (turnsOf(chatId).size === 0) return STEER_IDLE_REPLY
            await lease.agent.send(note, { ...untrustedContentSendOptions(), queueMode: 'steer' })
            return STEERED_REPLY
          } finally {
            lease.release()
          }
        }),
      running: () => turnsOf(chatId).size,
      stop: () => {
        const turns = [...turnsOf(chatId)]
        for (const turn of turns) turn.abort()
        return turns.length
      },
    })
  }
}
