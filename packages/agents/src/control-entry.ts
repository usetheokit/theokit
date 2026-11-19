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
