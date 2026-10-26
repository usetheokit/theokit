import type { MessageEvent, SessionRouter } from '@theokit/gateway'
import type { AgentOptions } from '@theokit/sdk'

import type { TurnAgent } from '../agent-port.js'
import type { Generations } from './generations.js'
import type { SessionSettings } from './session-settings.js'

/** A session's agent: kept open across turns and disposed only by `SessionAgents`. */
export interface SessionAgent extends TurnAgent {
  dispose(): Promise<void>
}

/**
 * What one turn holds of its session's agent. It carries neither `dispose` nor
 * `Symbol.asyncDispose`, so the request container that resolves it leaves the agent open (D2).
 */
export interface SessionLease {
  readonly agent: TurnAgent
  /** Ends this turn's hold on the agent; a second call does nothing. */
  release(): void
}

export interface SessionAgentsDeps {
  readonly router: SessionRouter
  /** `Agent.getOrCreate` in production; a fake in the unit tests. */
  readonly getOrCreate: (id: string, options: AgentOptions) => Promise<SessionAgent>
  readonly optionsFor: (event: MessageEvent) => AgentOptions
  readonly generations: Generations
  readonly settings: SessionSettings
  readonly write: (line: string) => void
}

interface Entry {
  readonly key: string
  readonly resolving: Promise<SessionAgent>
  /** Turns in flight: leases taken and not yet released. */
  leases: number
}

/** The agent id of a session key at a generation. */
export function agentIdFor(key: string, generation: number): string {
  return `theoclaw-${key}-g${generation}`
}

/**
 * The owner of every chat session's agent. One `getOrCreate` in flight per agent id, shared by
 * every message that asks while it resolves: the SDK's has no single-flight, and with its cache off
 * nothing else deduplicates two instances of one id (FR-004).
 */
export class SessionAgents {
  readonly #entries = new Map<string, Entry>()

  constructor(private readonly deps: SessionAgentsDeps) {}

  /** The agent of the event's session, held for one turn until `release()`. */
  async lease(event: MessageEvent): Promise<SessionLease> {
    const key = this.deps.router.resolveAgentId(event)
    const id = agentIdFor(key, this.deps.generations.current(key))
    const entry = this.#entries.get(id) ?? this.#resolve(id, key, event)
    entry.leases += 1
    let agent: SessionAgent
    try {
      agent = await entry.resolving
    } catch (error) {
      entry.leases -= 1
      throw error
    }
    let released = false
    return {
      agent,
      release: () => {
        if (released) return
        released = true
        entry.leases -= 1
      },
    }
  }

  #resolve(id: string, key: string, event: MessageEvent): Entry {
    const resolving = this.deps.getOrCreate(id, this.deps.optionsFor(event))
    const entry: Entry = { key, resolving, leases: 0 }
    this.#entries.set(id, entry)
    // A failed resolve leaves no entry, so the session's next message retries it.
    resolving.catch(() => {
      if (this.#entries.get(id) === entry) this.#entries.delete(id)
    })
    return entry
  }
}
