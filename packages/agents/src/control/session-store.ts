/**
 * Named sessions over agents: one kept agent per client-chosen session id, one turn at a time on
 * each, a bounded number kept, interrupt and steer of a running turn, a clean close.
 *
 * Ported from TheoClaw's `createControlSessions`, without its secret masking: pass that through
 * `sendOptions` or the `emit` callback.
 */
import { randomUUID } from 'node:crypto'

import type { AgentStreamEvent } from '../bridge/agent-stream-events.js'
import type { SdkMessage } from '../bridge/event-translator.js'
import { runAgentTurn, type AgentTurnOutcome } from '../bridge/run-agent-turn.js'
import type { SdkAgentHandle, SdkSendOptions } from '../bridge/sdk-adapter.js'

/** How a session turn ended: the turn's own outcome, or a refusal the store made. */
export type SessionOutcome =
  | AgentTurnOutcome
  | { ok: false; code: 'busy' | 'bad_session' | 'interrupted' }

export interface SessionStore {
  /** One turn on `session`, owned by `owner` (for example the socket that sent it). Never rejects. */
  run(
    session: string,
    message: string,
    emit: (e: AgentStreamEvent) => void,
    owner: object,
  ): Promise<SessionOutcome>
  /** Stop the session's running turn: `no_turn` when nothing runs there. */
  interrupt(session: string): 'cancelled' | 'no_turn'
  /** Inject `message` into the session's running turn (`queueMode: 'steer'`). */
  steer(session: string, message: string): Promise<'steered' | 'no_turn'>
  /** Stop every turn `owner` started. */
  cancelOwnedBy(owner: object): void
  /** Stop every turn, wait for them (up to `drainMs`), and dispose every agent. */
  close(): Promise<void>
}

export interface SessionStoreOptions {
  /** Builds one session's agent, on that session's first turn. */
  build: () => Promise<SdkAgentHandle<SdkMessage>>
  /** The most sessions kept at once. Default 16. */
  max?: number
  /** How long a turn waits for a cancelled turn on its session to unwind. Default 5000. */
  drainMs?: number
  /** What the model is told before the message that follows an interrupted turn. */
  redirectNote?: string
  /** Where a disposal that failed outside any turn is written, one line each. */
  report?: (line: string) => void
  /** Merged into every turn's `send`. */
  sendOptions?: SdkSendOptions
}

const DEFAULT_MAX = 16
const DEFAULT_DRAIN_MS = 5000
/** How long a turn on a running, not yet cancelled session waits for a close or interrupt in flight. */
const GRACE_MS = 250
const SESSION_ID = /^[A-Za-z0-9_-]{1,64}$/

const DEFAULT_REDIRECT_NOTE =
  '[The owner stopped your previous answer and withdrew that request. Do not continue it. Answer only the message below.]\n\n'

const INTERRUPTED: SessionOutcome = { ok: false, code: 'interrupted' }
const BUSY: SessionOutcome = { ok: false, code: 'busy' }
const CLOSING: SessionOutcome = {
  ok: false,
  code: 'turn_failed',
  reason: 'the session store is closed',
}

interface Turn {
  readonly controller: AbortController
  readonly owner: object
  cancelRequested: boolean
  finished: boolean
  /** Settles once the turn has unwound and the session can take the next one. */
  readonly ended: Promise<void>
  readonly end: () => void
}

interface Entry {
  agent: SdkAgentHandle<SdkMessage> | undefined
  /** The last turn was interrupted: the next message is a redirect. */
  interrupted: boolean
  lastUsed: number
  running: Turn | undefined
}

interface Admission {
  readonly entry: Entry
  readonly evicted: Entry | undefined
}

function newTurn(owner: object): Turn {
  let end = (): void => undefined
  const ended = new Promise<void>((resolve) => {
    end = resolve
  })
  return {
    controller: new AbortController(),
    owner,
    cancelRequested: false,
    finished: false,
    ended,
    end,
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Reads the signal through a call, so a flag set during an await is not narrowed away. */
function wasAborted(turn: Turn): boolean {
  return turn.controller.signal.aborted
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms).unref()
  })
}

export function createSessionStore(options: SessionStoreOptions): SessionStore {
  const max = options.max ?? DEFAULT_MAX
  if (!Number.isInteger(max) || max < 1) {
    throw new RangeError('createSessionStore: max must be a positive integer')
  }
  const drainMs = options.drainMs ?? DEFAULT_DRAIN_MS
  const redirectNote = options.redirectNote ?? DEFAULT_REDIRECT_NOTE
  const report = options.report ?? ((): void => undefined)
  const entries = new Map<string, Entry>()
  /** Turns waiting for a cancelled turn on their session to unwind: interruptible already. */
  const waiting = new Map<Turn, string>()
  let clock = 0
  let closed = false
  const isClosed = (): boolean => closed

  function evictIdle(): Entry | undefined {
    let victim: [string, Entry] | undefined
    for (const pair of entries) {
      if (
        pair[1].running === undefined &&
        (victim === undefined || pair[1].lastUsed < victim[1].lastUsed)
      ) {
        victim = pair
      }
    }
    if (victim !== undefined) entries.delete(victim[0])
    return victim?.[1]
  }

  /** Reserve the session's entry for one turn. Synchronous: no await inside. */
  function admit(session: string, turn: Turn): Admission | SessionOutcome {
    let entry = entries.get(session)
    if (entry?.running !== undefined) return BUSY
    let evicted: Entry | undefined
    if (entry === undefined) {
      if (entries.size >= max) {
        evicted = evictIdle()
        if (evicted === undefined) return BUSY
      }
      entry = { agent: undefined, interrupted: false, lastUsed: 0, running: undefined }
      entries.set(session, entry)
    }
    entry.running = turn
    entry.lastUsed = ++clock
    return { entry, evicted }
  }

  async function disposeReported(agent: SdkAgentHandle<SdkMessage>): Promise<void> {
    try {
      await agent.dispose()
    } catch (error) {
      report(`session store: agent disposal failed: ${describe(error)}`)
    }
  }

  function stop(turn: Turn): 'cancelled' | 'no_turn' {
    if (turn.finished) return 'no_turn'
    turn.cancelRequested = true
    turn.controller.abort()
    return 'cancelled'
  }

  function stoppable(session: string): Turn | undefined {
    for (const [turn, name] of waiting) {
      if (name === session && !turn.cancelRequested) return turn
    }
    return entries.get(session)?.running
  }

  async function drain(session: string): Promise<void> {
    const turn = entries.get(session)?.running
    if (turn === undefined) return
    if (!turn.cancelRequested) await Promise.race([turn.ended, delay(GRACE_MS)])
    if (turn.cancelRequested) await Promise.race([turn.ended, delay(drainMs)])
  }

  async function turnOn(
    session: string,
    { entry, evicted }: Admission,
    turn: Turn,
    message: string,
    emit: (e: AgentStreamEvent) => void,
  ): Promise<SessionOutcome> {
    // The evicted agent is gone before this session's agent is built: never more than `max` alive.
    if (evicted?.agent !== undefined) await disposeReported(evicted.agent)
    let agent = entry.agent
    if (agent === undefined) {
      if (turn.controller.signal.aborted) {
        entries.delete(session)
        return INTERRUPTED
      }
      try {
        agent = await options.build()
      } catch (error) {
        entries.delete(session)
        return { ok: false, code: 'turn_failed', reason: describe(error) }
      }
      if (wasAborted(turn)) {
        entries.delete(session)
        await disposeReported(agent)
        return INTERRUPTED
      }
      entry.agent = agent
    }
    const text = entry.interrupted ? `${redirectNote}${message}` : message
    entry.interrupted = false
    let outcome: AgentTurnOutcome
    try {
      outcome = await runAgentTurn({
        agent,
        message: text,
        runId: randomUUID(),
        emit,
        signal: turn.controller.signal,
        ...(options.sendOptions === undefined ? {} : { sendOptions: options.sendOptions }),
      })
    } finally {
      if (turn.cancelRequested) entry.interrupted = true
    }
    return turn.cancelRequested ? INTERRUPTED : outcome
  }

  async function run(
    session: string,
    message: string,
    emit: (e: AgentStreamEvent) => void,
    owner: object,
  ): Promise<SessionOutcome> {
    if (closed) return CLOSING
    if (!SESSION_ID.test(session)) return { ok: false, code: 'bad_session' }
    const turn = newTurn(owner)
    waiting.set(turn, session)
    try {
      await drain(session)
    } finally {
      waiting.delete(turn)
    }
    if (turn.controller.signal.aborted) {
      turn.finished = true
      turn.end()
      return INTERRUPTED
    }
    if (isClosed()) {
      turn.finished = true
      turn.end()
      return CLOSING
    }
    const admission = admit(session, turn)
    if ('ok' in admission) {
      turn.finished = true
      turn.end()
      return admission
    }
    const { entry } = admission
    try {
      return await turnOn(session, admission, turn, message, emit)
    } catch (error) {
      return turn.cancelRequested
        ? INTERRUPTED
        : { ok: false, code: 'turn_failed', reason: describe(error) }
    } finally {
      turn.finished = true
      if (entry.running === turn) entry.running = undefined
      turn.end()
    }
  }

  return {
    run,
    interrupt: (session) => {
      const turn = stoppable(session)
      return turn === undefined ? 'no_turn' : stop(turn)
    },
    steer: async (session, message) => {
      const entry = entries.get(session)
      const turn = entry?.running
      if (
        entry?.agent === undefined ||
        turn === undefined ||
        turn.finished ||
        turn.cancelRequested
      ) {
        return 'no_turn'
      }
      try {
        await entry.agent.send(message, { ...options.sendOptions, queueMode: 'steer' })
      } catch (error) {
        report(`session store: steer failed: ${describe(error)}`)
        return 'no_turn'
      }
      return 'steered'
    },
    cancelOwnedBy: (owner) => {
      for (const turn of waiting.keys()) {
        if (turn.owner === owner) stop(turn)
      }
      for (const entry of entries.values()) {
        if (entry.running?.owner === owner) stop(entry.running)
      }
    },
    close: async () => {
      closed = true
      for (const turn of waiting.keys()) stop(turn)
      const turns = [...entries.values()].flatMap((e) =>
        e.running === undefined ? [] : [e.running],
      )
      for (const turn of turns) stop(turn)
      // A turn whose build is still pending disposes its own agent when the build arrives.
      await Promise.race([Promise.all(turns.map((t) => t.ended)), delay(drainMs)])
      const agents = [...entries.values()].flatMap((e) => (e.agent === undefined ? [] : [e.agent]))
      entries.clear()
      const results = await Promise.allSettled(agents.map((a) => a.dispose()))
      const failure = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
      if (failure !== undefined) throw failure.reason
    },
  }
}
