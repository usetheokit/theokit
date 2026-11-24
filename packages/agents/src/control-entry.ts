/** Sub-path entry: @theokit/agents/control — named sessions with interrupt and steer. */
export {
  createSessionStore,
  type SessionOutcome,
  type SessionStore,
  type SessionStoreOptions,
} from './control/session-store.js'
export {
  createDevicePairing,
  type DevicePairing,
  type DevicePairingOptions,
  type PairingApproval,
  type PairingRequestResult,
} from './control/device-pairing.js'
export { pairRoute } from './control/pair-route.js'
export {
  attachControlSocket,
  type ControlSocketOptions,
  type SocketOutcome,
  type SocketSessions,
  type SocketVerdict,
} from './control/control-socket.js'
export {
  type AgentTurnUsage,
  type ControlClientFrame,
  type ControlServerFrame,
} from './control/frames.js'
export {
  ControlConnectionError,
  createControlClient,
  type ControlClient,
} from './control/control-client.js'
export {
  createControlStreamInbox,
  createControlStreamSource,
  type ControlStreamClient,
  type ControlStreamEvent,
  type ControlStreamFrame,
  type ControlStreamInbox,
  type ControlStreamNotice,
  type ControlStreamOptions,
  type ControlStreamSource,
} from './control/control-stream.js'
export {
  PairingRefusedError,
  redeemPairing,
  type RedeemedPairing,
  type RedeemPairingOptions,
} from './control/redeem-pairing.js'

// `attachControlSocket` takes the `node:http` server it attaches to, so its type crosses this barrel.
export type { Server } from 'node:http'
