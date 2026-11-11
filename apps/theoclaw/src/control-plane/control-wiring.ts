import type { TurnAgent } from '../agent-port.js'
import { createControlSessions } from './control-sessions.js'
import { createDevicePairing, type DevicePairing } from './device-pairing.js'
import type { ControlSocketOptions } from './control-socket.js'
import { rpcRoute } from './rpc-route.js'
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

/**
 * Device pairing (OC-91) needs a state directory to keep the approved devices and a control token
 * for the owner to approve with; without either it is off and `/control` is unchanged.
 */
export function devicePairingFor(
  stateDir: string | undefined,
  controlToken: string | undefined,
  write: (line: string) => void,
): DevicePairing | undefined {
  return stateDir === undefined || controlToken === undefined ? undefined : createDevicePairing({ dir: stateDir, write })
}

/**
 * The admin HTTP RPC (OC-128) is opt-in: `THEOCLAW_ADMIN_HTTP_RPC=1`, and it needs the control token
 * (its bearer) and device pairing (the methods it exposes).
 */
export function adminRpcFor(
  env: Readonly<Record<string, string | undefined>>,
  controlToken: string | undefined,
  devices: DevicePairing | undefined,
): ((request: Request) => Promise<Response>) | undefined {
  if (env.THEOCLAW_ADMIN_HTTP_RPC !== '1' || controlToken === undefined || devices === undefined) return undefined
  return rpcRoute(controlToken, devices)
}
