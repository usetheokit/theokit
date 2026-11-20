/**
 * Named sessions over agents: one kept agent per client-chosen session id, one turn at a time on
 * each, a bounded number kept, interrupt and steer of a running turn, a clean close.
 *
 * Ported from TheoClaw's `createControlSessions`, without its secret masking: pass that through
 * `sendOptions` or the `emit` callback.
 */

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

/** What one store keeps between calls; every function below reads or changes it. */
interface StoreState {
  readonly options: SessionStoreOptions
  readonly max: number
  readonly drainMs: number
  readonly redirectNote: string
  readonly report: (line: string) => void
  readonly entries: Map<string, Entry>
  /** Turns waiting for a cancelled turn on their session to unwind: interruptible already. */
  readonly waiting: Map<Turn, string>
  clock: number
  closed: boolean
}

/** One turn's message and where its events go. */
interface TurnRequest {
  readonly message: string
  readonly emit: (e: AgentStreamEvent) => void
}

/** Reads the flag through a call, so a close during an await is not narrowed away. */
function isClosed(state: StoreState): boolean {
  return state.closed
}

function evictIdle(state: StoreState): Entry | undefined {
  let victim: [string, Entry] | undefined
  for (const pair of state.entries) {
    if (
      pair[1].running === undefined &&
      (victim === undefined || pair[1].lastUsed < victim[1].lastUsed)
    ) {
      victim = pair
    }
  }
  if (victim !== undefined) state.entries.delete(victim[0])
  return victim?.[1]
}

/** Reserve the session's entry for one turn. Synchronous: no await inside. */
function admit(state: StoreState, session: string, turn: Turn): Admission | SessionOutcome {
  let entry = state.entries.get(session)
  if (entry?.running !== undefined) return BUSY
  let evicted: Entry | undefined
  if (entry === undefined) {
    if (state.entries.size >= state.max) {
      evicted = evictIdle(state)
      if (evicted === undefined) return BUSY
    }
    entry = { agent: undefined, interrupted: false, lastUsed: 0, running: undefined }
    state.entries.set(session, entry)
  }
  entry.running = turn
  entry.lastUsed = ++state.clock
  return { entry, evicted }
}

async function disposeReported(
  state: StoreState,
  agent: SdkAgentHandle<SdkMessage>,
): Promise<void> {
  try {
    await agent.dispose()
  } catch (error) {
    state.report(`session store: agent disposal failed: ${describe(error)}`)
  }
}

function stop(turn: Turn): 'cancelled' | 'no_turn' {
  if (turn.finished) return 'no_turn'
  turn.cancelRequested = true
  turn.controller.abort()
  return 'cancelled'
}

function stoppable(state: StoreState, session: string): Turn | undefined {
  for (const [turn, name] of state.waiting) {
    if (name === session && !turn.cancelRequested) return turn
  }
  return state.entries.get(session)?.running
}

async function drain(state: StoreState, session: string): Promise<void> {
  const turn = state.entries.get(session)?.running
  if (turn === undefined) return
  if (!turn.cancelRequested) await Promise.race([turn.ended, delay(GRACE_MS)])
  if (turn.cancelRequested) await Promise.race([turn.ended, delay(state.drainMs)])
}

/** The session's kept agent, built on its first turn; an outcome when the turn ends before it. */
async function agentFor(
  state: StoreState,
  session: string,
  entry: Entry,
  turn: Turn,
): Promise<SdkAgentHandle<SdkMessage> | SessionOutcome> {
  if (entry.agent !== undefined) return entry.agent
  if (turn.controller.signal.aborted) {
    state.entries.delete(session)
    return INTERRUPTED
  }
  let agent: SdkAgentHandle<SdkMessage>
  try {
    agent = await state.options.build()
  } catch (error) {
    state.entries.delete(session)
    return { ok: false, code: 'turn_failed', reason: describe(error) }
  }
  if (wasAborted(turn)) {
    state.entries.delete(session)
    await disposeReported(state, agent)
    return INTERRUPTED
  }
  entry.agent = agent
  return agent
}

async function turnOn(
  state: StoreState,
  session: string,
  { entry, evicted }: Admission,
  turn: Turn,
  request: TurnRequest,
): Promise<SessionOutcome> {
  // The evicted agent is gone before this session's agent is built: never more than `max` alive.
  if (evicted?.agent !== undefined) await disposeReported(state, evicted.agent)
  const agent = await agentFor(state, session, entry, turn)
  if ('ok' in agent) return agent
  const text = entry.interrupted ? `${state.redirectNote}${request.message}` : request.message
  entry.interrupted = false
  let outcome: AgentTurnOutcome
  try {
    outcome = await runAgentTurn({
      agent,
      message: text,
      runId: crypto.randomUUID(),
      emit: request.emit,
      signal: turn.controller.signal,
      ...(state.options.sendOptions === undefined
        ? {}
        : { sendOptions: state.options.sendOptions }),
    })
  } finally {
    if (turn.cancelRequested) entry.interrupted = true
  }
  return turn.cancelRequested ? INTERRUPTED : outcome
}

/** Ends a turn that never took its session. */
function refuse(turn: Turn, outcome: SessionOutcome): SessionOutcome {
  turn.finished = true
  turn.end()
  return outcome
}

async function run(
  state: StoreState,
  session: string,
  message: string,
  emit: (e: AgentStreamEvent) => void,
  owner: object,
): Promise<SessionOutcome> {
  if (state.closed) return CLOSING
  if (!SESSION_ID.test(session)) return { ok: false, code: 'bad_session' }
  const turn = newTurn(owner)
  state.waiting.set(turn, session)
  try {
    await drain(state, session)
  } finally {
    state.waiting.delete(turn)
  }
  if (turn.controller.signal.aborted) return refuse(turn, INTERRUPTED)
  if (isClosed(state)) return refuse(turn, CLOSING)
  const admission = admit(state, session, turn)
  if ('ok' in admission) return refuse(turn, admission)
  const { entry } = admission
  try {
    return await turnOn(state, session, admission, turn, { message, emit })
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

async function steer(
  state: StoreState,
  session: string,
  message: string,
): Promise<'steered' | 'no_turn'> {
  const entry = state.entries.get(session)
  const turn = entry?.running
  if (entry?.agent === undefined || turn === undefined || turn.finished || turn.cancelRequested) {
    return 'no_turn'
  }
  try {
    await entry.agent.send(message, { ...state.options.sendOptions, queueMode: 'steer' })
  } catch (error) {
    state.report(`session store: steer failed: ${describe(error)}`)
    return 'no_turn'
  }
  return 'steered'
}

function cancelOwnedBy(state: StoreState, owner: object): void {
  for (const turn of state.waiting.keys()) {
    if (turn.owner === owner) stop(turn)
  }
  for (const entry of state.entries.values()) {
    if (entry.running?.owner === owner) stop(entry.running)
  }
}

async function close(state: StoreState): Promise<void> {
  state.closed = true
  for (const turn of state.waiting.keys()) stop(turn)
  const turns = [...state.entries.values()].flatMap((e) =>
    e.running === undefined ? [] : [e.running],
  )
  for (const turn of turns) stop(turn)
  // A turn whose build is still pending disposes its own agent when the build arrives.
  await Promise.race([Promise.all(turns.map((t) => t.ended)), delay(state.drainMs)])
  const agents = [...state.entries.values()].flatMap((e) =>
    e.agent === undefined ? [] : [e.agent],
  )
  state.entries.clear()
  const results = await Promise.allSettled(agents.map((a) => a.dispose()))
  const failure = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
  if (failure !== undefined) throw failure.reason
}

export function createSessionStore(options: SessionStoreOptions): SessionStore {
  const max = options.max ?? DEFAULT_MAX
  if (!Number.isInteger(max) || max < 1) {
    throw new RangeError('createSessionStore: max must be a positive integer')
  }
  const state: StoreState = {
    options,
    max,
    drainMs: options.drainMs ?? DEFAULT_DRAIN_MS,
    redirectNote: options.redirectNote ?? DEFAULT_REDIRECT_NOTE,
    report: options.report ?? ((): void => undefined),
    entries: new Map(),
    waiting: new Map(),
    clock: 0,
    closed: false,
  }
  return {
    run: (session, message, emit, owner) => run(state, session, message, emit, owner),
    interrupt: (session) => {
      const turn = stoppable(state, session)
      return turn === undefined ? 'no_turn' : stop(turn)
    },
    steer: (session, message) => steer(state, session, message),
    cancelOwnedBy: (owner) => {
      cancelOwnedBy(state, owner)
    },
    close: () => close(state),
  }
}
