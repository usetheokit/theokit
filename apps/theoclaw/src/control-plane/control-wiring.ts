import type { TurnAgent } from '../agent-port.js'
import { createControlSessions } from './control-sessions.js'
import type { ControlSocketOptions } from './control-socket.js'
import { createTurnRunner, type WithAgent } from './turn.js'

/**
 * The `/control` socket's options: the sessionless runner over the per-turn container, and the named
 * sessions, whose agents come from `build` (the same factory call the per-turn container makes) and
 * are kept until the control plane closes. Here rather than in `composition.ts`, which is at its
 * size budget.
 */
export function controlOptions(
  token: string,
  withAgent: WithAgent,
  build: () => Promise<TurnAgent>,
  report: (line: string) => void,
): ControlSocketOptions {
  return { token, runTurn: createTurnRunner(withAgent), sessions: createControlSessions({ build, report }) }
}
