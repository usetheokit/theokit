/**
 * `@theokit/agents/a2a` — call a remote agent over HTTP as a tool.
 *
 * A subpath rather than a member of the root barrel. The root bundle reached 41 992 bytes against
 * its 42 000-byte cap once `createA2ATool` learned to read the served event stream (B-407), and the
 * A2A client is a remote-delegation tool most agents never import. Moving it here means an app that
 * never delegates over the network does not pay for it (bundle decision F-arch-5).
 *
 * The agent card and the MCP server manifest stay in the root barrel: they describe THIS agent to
 * others, and they are not what this subpath is for.
 */
export { createA2ATool } from './a2a/a2a-client.js'
export type { A2AAuth, A2AToolConfig } from './a2a/a2a-client.js'
