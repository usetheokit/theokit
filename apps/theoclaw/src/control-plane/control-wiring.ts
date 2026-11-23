import { createDevicePairing, type DevicePairing } from '@theokit/agents/control'

import type { TurnAgent } from '../agent-port.js'
import { createControlSessions } from './control-sessions.js'
import { describeError, TheoClawConfigError } from './errors.js'
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
  secrets: readonly string[] = [],
  devices?: DevicePairing,
  model?: string,
): ControlSocketOptions {
  return {
    token,
    runTurn: createTurnRunner(withAgent, secrets, model),
    sessions: createControlSessions({ build, report, secrets, ...(model === undefined ? {} : { model }) }),
    ...(devices === undefined ? {} : { devices }),
  }
}

/** What `openDevicePairing` takes: the state directory, and the clock and report line a test replaces. */
export interface PairingOptions {
  readonly dir: string
  readonly clock?: () => number
  readonly write?: (line: string) => void
}

/**
 * The framework's device store over `devices.json` in the state directory. A file that cannot be
 * read or parsed stops the start with `TheoClawConfigError` naming `THEOCLAW_STATE_DIR`.
 */
export function openDevicePairing(options: PairingOptions): DevicePairing {
  const write = options.write ?? ((line: string) => void process.stderr.write(`${line}\n`))
  try {
    return createDevicePairing({ dir: options.dir, report: write, ...(options.clock === undefined ? {} : { now: options.clock }) })
  } catch (error) {
    throw new TheoClawConfigError(describeError(error), { variable: 'THEOCLAW_STATE_DIR' })
  }
}

/**
 * Device pairing (OC-91) needs a state directory to keep the approved devices and a control token
 * for the owner to approve with; without either it is off and `/control` is unchanged.
 */
export function devicePairingFor(
  stateDir: string | undefined,
  controlToken: string | undefined,
  write: (line: string) => void,
): DevicePairing | undefined {
  return stateDir === undefined || controlToken === undefined ? undefined : openDevicePairing({ dir: stateDir, write })
}
