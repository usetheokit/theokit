/** Sub-path entry: @theokit/http/runtime/node */
export {
  nodeIncomingToRequest,
  writeResponseToNode,
  createNodeAdapter,
  createNodeServer,
  BindError,
} from './bridge/runtime/node.js'
export type { RuntimeAdapter, ServerHandle } from './bridge/runtime/types.js'
export type { NodeServer, NodeServerOptions } from './bridge/runtime/node.js'
export {
  PEER_ADDRESS_HEADER,
  TRUSTED_IDENTITY_HEADER,
  trustedIdentity,
  peerAddress,
} from './bridge/runtime/trusted-proxy.js'
export type { TrustedProxyOptions } from './bridge/runtime/trusted-proxy.js'
