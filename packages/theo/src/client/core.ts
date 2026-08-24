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
export { AgentClient } from '@theokit/agents/client'
export type { AgentClientState, UseAgentStatus } from '@theokit/agents/client'
// theokit#384 — a run whose connection dropped settles `status: 'error'` carrying THIS error. It is
// the only way to tell a resumable interruption from a real failure without matching message text.
export { AgentStreamInterruptedError } from '@theokit/agents/client'

// The transport seam + the three shipped transports (identical to the React entry's exports).
export type { AgentTransport, ApprovalDecision, RequestContext } from '@theokit/agents/client'
export { HttpTransport } from '@theokit/agents/client'
export type { HttpTransportOptions, HeadersResolver } from '@theokit/agents/client'
export { InProcessTransport } from '@theokit/agents/client'
export type {
  InProcessTransportOptions,
  InProcessRunner,
  InProcessRunInput,
  InProcessApprovalRequestLike,
  InProcessAwaitApproval,
} from '@theokit/agents/client'
export { ChannelTransport } from '@theokit/agents/client'
export type {
  ChannelTransportOptions,
  ChannelPushSource,
  ChannelTurnHandlers,
} from '@theokit/agents/client'

// The wire readers (used to build custom transports).
export {
  consumeUIMessageStream,
  responseToChunkStream,
  consumeChunkStream,
} from '@theokit/agents/client'
