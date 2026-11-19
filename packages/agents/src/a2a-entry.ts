/**
 * `@theokit/agents/a2a` — call a remote agent over HTTP as a tool.
 *
 * A subpath rather than a member of the root barrel. The root bundle reached 41 992 bytes against
 * its 42 000-byte cap once `createA2ATool` learned to read the served event stream (B-407), and the
 * A2A client is a remote-delegation tool most agents never import. Moving it here means an app that
 * never delegates over the network does not pay for it (bundle decision F-arch-5).
 *
 * The agent card builder is also exported here (and stays in the root barrel); the MCP server
 * manifest stays in the root barrel only.
 */
export { createA2ATool } from './a2a/a2a-client.js'
export type { A2AAuth, A2AToolConfig } from './a2a/a2a-client.js'
export { createA2AJsonRpcHandler } from './a2a/a2a-json-rpc-handler.js'
export type { A2AJsonRpcHandlerOptions } from './a2a/a2a-json-rpc-handler.js'
export { buildAgentCard, agentCardPath, wellKnownCardPath } from './a2a/agent-card.js'
export type {
  A2ACapabilities,
  A2ASkill,
  AgentCard,
  BuildAgentCardOptions,
  PlainAgentCardInput,
} from './a2a/agent-card.js'
