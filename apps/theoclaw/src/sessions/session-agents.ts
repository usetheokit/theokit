import type { TurnAgent } from '../agent-port.js'

/** A session's agent: kept open across turns and disposed only by the chat session pool. */
export interface SessionAgent extends TurnAgent {
  dispose(): Promise<void>
}

/**
 * What one turn holds of its session's agent. It carries neither `dispose` nor
 * `Symbol.asyncDispose`, so the request container that resolves it leaves the agent open (D2).
 */
export interface SessionLease {
  readonly agent: TurnAgent
  /** The agent id of the session at its generation; what `Agent.compact` takes. */
  readonly agentId?: string
  /** Ends this turn's hold on the agent; a second call does nothing. */
  release(): void
}

/** The agent id of a session key at a generation. */
export function agentIdFor(key: string, generation: number): string {
  return `theoclaw-${key}-g${generation}`
}
