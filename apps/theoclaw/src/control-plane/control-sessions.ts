import { randomUUID } from 'node:crypto'

import type { TurnAgent, TurnRun } from '../agent-port.js'
import { describeError } from './errors.js'
import { runSessionTurn } from './session-turn.js'
import type { TurnEvent, TurnOutcome } from './turn.js'

/** The most `/control` sessions kept open at once (FR-006). */
export const MAX_CONTROL_SESSIONS = 16

/** How long a turn sent to a session waits for that session's cancelled turn to unwind. */
export const CANCEL_DRAIN_MS = 5000

/** A session id a client may choose: it names a stderr line, so it carries no free text. */
const SESSION_ID = /^[A-Za-z0-9_-]{1,64}$/

/** How a session turn ended: a turn's own outcome, or a refusal the store made. */
export type SessionOutcome =
  | TurnOutcome
  | { readonly ok: false; readonly code: 'busy' | 'bad_frame' | 'interrupted' }

export interface ControlSessionsOptions {
  /** Builds one session's agent, on that session's first turn. */
  readonly build: () => Promise<TurnAgent>
  readonly maxSessions?: number
  /** Default {@link CANCEL_DRAIN_MS}. */
  readonly drainMs?: number
  /** Where a disposal that failed outside any turn is written, one line each. */
  readonly report: (line: string) => void
}

export interface ControlSessions {
  /** One turn on `session`, owned by `owner` (the socket that sent it). Never rejects. */
  run(session: string, message: string, emit: (event: TurnEvent) => void, owner: object): Promise<SessionOutcome>
  /** Stop the session's running turn: `no_turn` when nothing runs there. */
  interrupt(session: string): 'cancelled' | 'no_turn'
  /** Stop every running turn `owner` sent (its socket closed, FR-005). */
  cancelOwnedBy(owner: object): void
  /** Stop every turn, wait for them and for every pending build, and dispose every agent. */
  close(): Promise<void>
}

interface Running {
  readonly controller: AbortController
  readonly owner: object
  cancelRequested: boolean
  eventsEnded: boolean
  run: TurnRun | undefined
  /** Settles once the turn has unwound and the session can take the next one. */
  readonly ended: Promise<void>
  readonly end: () => void
}

interface Entry {
  agent: TurnAgent | undefined
  lastUsed: number
  running: Running | undefined
}

/** A reserved entry, and the idle one it pushed out of the store, whose agent is still to dispose. */
interface Admission {
  readonly entry: Entry
  readonly evicted: Entry | undefined
}

const INTERRUPTED: SessionOutcome = { ok: false, code: 'interrupted' }
const BUSY: SessionOutcome = { ok: false, code: 'busy' }

function running(owner: object): Running {
  let end = (): void => undefined
  const ended = new Promise<void>((resolve) => {
    end = resolve
  })
  return { controller: new AbortController(), owner, cancelRequested: false, eventsEnded: false, run: undefined, ended, end }
}

/** The agent's disposal through `Symbol.asyncDispose`, the boundary `agent-port.ts` documents. */
async function dispose(agent: TurnAgent): Promise<void> {
  await (agent as Partial<AsyncDisposable>)[Symbol.asyncDispose]?.()
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms).unref()
  })
}

/**
 * The `/control` sessions (plan D3): one kept agent per client-chosen session id, one turn at a
 * time per session, at most `maxSessions` kept. Admission is synchronous, so a reservation counts
 * against the bound before any await and two new sessions cannot both take the last slot; a full
 * store disposes its least recently used idle agent, or answers `busy` when every session runs.
 * Each turn is sent with its own `AbortController`'s signal, created before `send` is called, so an
 * interrupt in the pending window still reaches it (EC-1).
 */
export function createControlSessions(options: ControlSessionsOptions): ControlSessions {
  const maxSessions = options.maxSessions ?? MAX_CONTROL_SESSIONS
  const drainMs = options.drainMs ?? CANCEL_DRAIN_MS
  const entries = new Map<string, Entry>()
  let clock = 0
  let closed = false

  /** Remove the least recently used idle entry, for a new session to take its slot. */
  function evictIdle(): Entry | undefined {
    let victim: [string, Entry] | undefined
    for (const pair of entries) {
      if (pair[1].running === undefined && (victim === undefined || pair[1].lastUsed < victim[1].lastUsed)) victim = pair
    }
    if (victim !== undefined) entries.delete(victim[0])
    return victim?.[1]
  }

  /** The session's entry, reserved for one turn, or the refusal. Synchronous: no await inside. */
  function admit(session: string, turn: Running): Admission | SessionOutcome {
    let entry = entries.get(session)
    if (entry?.running !== undefined) return BUSY
    let evicted: Entry | undefined
    if (entry === undefined) {
      if (entries.size >= maxSessions) {
        evicted = evictIdle()
        if (evicted === undefined) return BUSY
      }
      entry = { agent: undefined, lastUsed: 0, running: undefined }
      entries.set(session, entry)
    }
    entry.running = turn
    entry.lastUsed = ++clock
    return { entry, evicted }
  }

  async function disposeReported(agent: TurnAgent): Promise<void> {
    try {
      await dispose(agent)
    } catch (error) {
      options.report(`theoclaw: control session agent disposal failed: ${describeError(error)}`)
    }
  }

  function stop(turn: Running): 'cancelled' | 'no_turn' {
    if (turn.eventsEnded) return 'no_turn'
    turn.cancelRequested = true
    turn.controller.abort()
    turn.run?.cancel?.().catch((error: unknown) => {
      options.report(`theoclaw: control session cancel failed: ${describeError(error)}`)
    })
    return 'cancelled'
  }

  /** Wait, at most `drainMs`, for a cancelled turn on `session` to unwind. */
  async function drain(session: string): Promise<void> {
    const turn = entries.get(session)?.running
    if (turn?.cancelRequested === true) await Promise.race([turn.ended, delay(drainMs)])
  }

  async function turnOn(
    session: string,
    { entry, evicted }: Admission,
    turn: Running,
    message: string,
    emit: (event: TurnEvent) => void,
  ): Promise<SessionOutcome> {
    // The evicted agent is gone before this session's agent is built, so no more than
    // `maxSessions` agents are ever alive at once.
    if (evicted?.agent !== undefined) await disposeReported(evicted.agent)
    let agent = entry.agent
    if (agent === undefined) {
      try {
        agent = await options.build()
      } catch (error) {
        entries.delete(session)
        return { ok: false, code: 'turn_failed', reason: describeError(error) }
      }
      if (turn.controller.signal.aborted) {
        // Interrupted, or the store closed, while the agent was being built: nothing is sent, and
        // the entry goes so that the next turn on the session builds again.
        entries.delete(session)
        await disposeReported(agent)
        return INTERRUPTED
      }
      entry.agent = agent
    }
    const outcome = await runSessionTurn(agent, {
      message,
      runId: randomUUID(),
      signal: turn.controller.signal,
      emit,
      onRun: (run) => {
        turn.run = run
        if (turn.cancelRequested) void run.cancel?.()
      },
    })
    turn.eventsEnded = true
    return turn.cancelRequested ? INTERRUPTED : outcome
  }

  async function run(session: string, message: string, emit: (event: TurnEvent) => void, owner: object): Promise<SessionOutcome> {
    if (closed) return { ok: false, code: 'turn_failed', reason: 'the control plane is closing' }
    if (!SESSION_ID.test(session)) return { ok: false, code: 'bad_frame' }
    await drain(session)
    if (closed) return { ok: false, code: 'turn_failed', reason: 'the control plane is closing' }
    const turn = running(owner)
    const admission = admit(session, turn)
    if ('ok' in admission) return admission
    const { entry } = admission
    try {
      return await turnOn(session, admission, turn, message, emit)
    } catch (error) {
      return turn.cancelRequested ? INTERRUPTED : { ok: false, code: 'turn_failed', reason: describeError(error) }
    } finally {
      turn.eventsEnded = true
      if (entry.running === turn) entry.running = undefined
      turn.end()
    }
  }

  return {
    run,
    interrupt: (session) => {
      const turn = entries.get(session)?.running
      return turn === undefined ? 'no_turn' : stop(turn)
    },
    cancelOwnedBy: (owner) => {
      for (const entry of entries.values()) {
        if (entry.running?.owner === owner) stop(entry.running)
      }
    },
    close: async () => {
      closed = true
      const turns = [...entries.values()].flatMap((entry) => (entry.running === undefined ? [] : [entry.running]))
      for (const turn of turns) stop(turn)
      // A turn whose build is held disposes its own agent when the build arrives (`turnOn`).
      await Promise.race([Promise.all(turns.map((turn) => turn.ended)), delay(drainMs)])
      const agents = [...entries.values()].flatMap((entry) => (entry.agent === undefined ? [] : [entry.agent]))
      entries.clear()
      const results = await Promise.allSettled(agents.map(dispose))
      const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
      if (failure !== undefined) throw failure.reason
    },
  }
}
