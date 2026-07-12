/**
 * M44 (ADR-0053) — `theokit/client/core`: the React-FREE agent-client entry.
 *
 * Everything needed to consume an agent from a node script, a CLI, a test, or a non-React UI — the
 * framework-agnostic {@link AgentClient} store, the three transports, and {@link createAgentClient} —
 * WITHOUT importing React. `theokit/client` (the React entry) adds `useAgent` on top of this; a node
 * consumer imports `theokit/client/core` and never pulls React into its bundle.
 */

// The standalone client + the store it wraps.
export { createAgentClient } from './create-agent-client.js'
export type { AgentClientHandle, CreateAgentClientOptions } from './create-agent-client.js'
export { AgentClient } from './agent-client.js'
export type { AgentClientState, UseAgentStatus } from './agent-client.js'

// The transport seam + the three shipped transports (identical to the React entry's exports).
export type { AgentTransport, ApprovalDecision, RequestContext } from './transport.js'
export { HttpTransport } from './http-transport.js'
export type { HttpTransportOptions, HeadersResolver } from './http-transport.js'
export { InProcessTransport } from './in-process-transport.js'
export type {
  InProcessTransportOptions,
  InProcessRunner,
  InProcessRunInput,
  InProcessApprovalRequestLike,
  InProcessAwaitApproval,
} from './in-process-transport.js'
export { ChannelTransport } from './channel-transport.js'
export type {
  ChannelTransportOptions,
  ChannelPushSource,
  ChannelTurnHandlers,
} from './channel-transport.js'

// The wire readers (used to build custom transports).
export {
  consumeUIMessageStream,
  responseToChunkStream,
  consumeChunkStream,
} from './consume-ui-message-stream.js'
