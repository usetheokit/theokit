import type { AgentLease } from '@theokit/gateway-agent'

import type { TurnAgent } from '../agent-port.js'

/** Runs `work` with one agent of its own request, as `createContainer().withAgent` does. */
export type EventWithAgent = <R>(work: (agent: TurnAgent) => R | Promise<R>) => Promise<R>

/**
 * The lease `createEventRun` asks for, over a request boundary: the boundary opens when the agent
 * is asked for and stays open until `release()`, which resolves once the boundary has disposed it.
 */
export function leaseFrom(withAgent: EventWithAgent): () => Promise<AgentLease> {
  return () =>
    new Promise<AgentLease>((resolve, reject) => {
      let finish: () => void = () => undefined
      const held = new Promise<void>((done) => {
        finish = done
      })
      const boundary = withAgent((agent) => {
        resolve({
          agent,
          release: () => {
            finish()
            return boundary.then(() => undefined)
          },
        })
        return held
      })
      boundary.catch(reject)
    })
}
