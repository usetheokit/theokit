import type { MessageEvent, SessionRouter } from '@theokit/gateway'
import type { AgentOptions } from '@theokit/sdk'

import type { TurnAgent } from '../agent-port.js'
import { describeError } from '../control-plane/errors.js'
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
  readonly sessionKey: string
  readonly resolving: Promise<SessionAgent>
  /** Set once the resolve succeeded: the entry is then an open agent. */
  agent: SessionAgent | undefined
  /** Turns in flight: leases taken and not yet released. */
  leases: number
  /** When the last turn ended, for the idle limit. */
  lastUsedAt: number
  /** A counter rather than a clock, so two turns ending in one millisecond still order. */
  lastUsedOrder: number
  /** Set while the agent is being disposed; a lease of its id waits for it (EC-1). */
  disposing: Promise<void> | undefined
}

/** How often the idle sweep runs: the "within 60 s after the limit" of NFR-004. */
const SWEEP_INTERVAL_MS = 60_000
/** How long stopping waits for turns in flight before disposing their agents anyway (EC-2). */
const STOP_WAIT_MS = 30_000

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
  readonly #sweep: ReturnType<typeof setInterval>
  #order = 0
  #warnedAboveBound = false
  #allReleased: (() => void) | undefined

  constructor(private readonly deps: SessionAgentsDeps) {
    this.#sweep = setInterval(() => this.#disposeIdle(), SWEEP_INTERVAL_MS)
    // The sweep never keeps the process alive.
    this.#sweep.unref()
  }

  /** The agent of the event's session, held for one turn until `release()`. */
  async lease(event: MessageEvent): Promise<SessionLease> {
    const key = this.deps.router.resolveAgentId(event)
    const id = agentIdFor(key, this.deps.generations.current(key))
    let found = this.#entries.get(id)
    // A session whose agent is being disposed resumes only once the dispose has settled (EC-1).
    while (found?.disposing !== undefined) {
      await found.disposing
      found = this.#entries.get(id)
    }
    const entry = found ?? this.#resolve(id, key, event)
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
        entry.lastUsedAt = Date.now()
        entry.lastUsedOrder = ++this.#order
        this.#trimToBound()
        if (this.#leasesHeld() === 0) this.#allReleased?.()
      },
    }
  }

  #resolve(id: string, key: string, event: MessageEvent): Entry {
    const resolving = this.deps.getOrCreate(id, this.deps.optionsFor(event))
    const entry: Entry = {
      sessionKey: key,
      resolving,
      agent: undefined,
      leases: 0,
      lastUsedAt: Date.now(),
      lastUsedOrder: ++this.#order,
      disposing: undefined,
    }
    this.#entries.set(id, entry)
    resolving.then(
      (agent) => {
        entry.agent = agent
        this.#trimToBound()
      },
      // A failed resolve leaves no entry, so the session's next message retries it.
      () => {
        if (this.#entries.get(id) === entry) this.#entries.delete(id)
      },
    )
    return entry
  }

  /**
   * Dispose every open agent: after the turns in flight end, or after 30 s, whichever comes first
   * (EC-2). A reply is sent after the SDK's run ends, so the lease, which spans the turn and its
   * reply, is what keeps stopping from cutting a reply off. Each session still held at the deadline
   * is named in one line.
   */
  async disposeAll(): Promise<void> {
    clearInterval(this.#sweep)
    await this.#waitForReleases()
    for (const entry of this.#entries.values()) {
      if (entry.leases > 0) this.deps.write(`theoclaw: stopping with a turn still running in session ${entry.sessionKey}`)
    }
    await Promise.all(
      [...this.#entries].map(async ([id, entry]) => {
        if (entry.disposing !== undefined) return entry.disposing
        const agent = entry.agent ?? (await entry.resolving.catch(() => undefined))
        if (agent === undefined) return undefined
        entry.agent = agent
        return this.#dispose(id, entry, agent)
      }),
    )
  }

  #leasesHeld(): number {
    let held = 0
    for (const entry of this.#entries.values()) held += entry.leases
    return held
  }

  async #waitForReleases(): Promise<void> {
    if (this.#leasesHeld() === 0) return
    let timer: ReturnType<typeof setTimeout> | undefined
    await new Promise<void>((resolve) => {
      this.#allReleased = resolve
      timer = setTimeout(resolve, STOP_WAIT_MS)
      timer.unref()
    })
    clearTimeout(timer)
    this.#allReleased = undefined
  }

  /** Open agents a sweep or the bound may dispose: resolved, not disposing, no turn in flight. */
  #idleEntries(): [string, Entry, SessionAgent][] {
    const idle: [string, Entry, SessionAgent][] = []
    for (const [id, entry] of this.#entries) {
      if (entry.agent !== undefined && entry.disposing === undefined && entry.leases === 0) idle.push([id, entry, entry.agent])
    }
    return idle
  }

  #openCount(): number {
    let open = 0
    for (const entry of this.#entries.values()) if (entry.agent !== undefined && entry.disposing === undefined) open += 1
    return open
  }

  #disposeIdle(): void {
    const limit = Date.now() - this.deps.settings.idleMinutes * 60_000
    for (const [id, entry, agent] of this.#idleEntries()) {
      if (entry.lastUsedAt <= limit) void this.#dispose(id, entry, agent)
    }
  }

  /**
   * Above `THEOCLAW_MAX_OPEN_SESSIONS`, dispose the least recently used agents with no turn in
   * flight. Checked when an agent opens and when a turn ends, so sessions busy when the bound was
   * crossed are trimmed once they go idle; a bound exceeded only by busy agents is said once.
   */
  #trimToBound(): void {
    const max = this.deps.settings.maxOpenSessions
    const idle = this.#idleEntries().sort(([, a], [, b]) => a.lastUsedOrder - b.lastUsedOrder)
    for (const [id, entry, agent] of idle) {
      if (this.#openCount() <= max) break
      void this.#dispose(id, entry, agent)
    }
    const open = this.#openCount()
    if (open <= max) {
      this.#warnedAboveBound = false
    } else if (!this.#warnedAboveBound) {
      this.#warnedAboveBound = true
      this.deps.write(`theoclaw: ${open} chat sessions are open, above THEOCLAW_MAX_OPEN_SESSIONS=${max}, every one with a turn in flight`)
    }
  }

  #dispose(id: string, entry: Entry, agent: SessionAgent): Promise<void> {
    entry.disposing = (async () => {
      try {
        await agent.dispose()
      } catch (error) {
        this.deps.write(`theoclaw: disposing the agent of session ${entry.sessionKey} failed: ${describeError(error)}`)
      } finally {
        if (this.#entries.get(id) === entry) this.#entries.delete(id)
      }
    })()
    return entry.disposing
  }
}
