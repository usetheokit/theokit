/**
 * `@theokit/agents/mcp-health` — per-turn, per-server MCP health, and the inventory built from it.
 *
 * A subpath rather than a member of the main barrel, for the reason the M76 bundle finding
 * established and this milestone re-measured (36 797 bytes against a 36 500 ceiling): an app that
 * only defines an agent should not carry the machinery for a UI that renders server status.
 *
 * The `RunEvent` union and the `McpServerFailedEvent` member DO cross from the main barrel — a type
 * costs zero bytes, and the whole point of the milestone is that a consumer had to duck-check the
 * payload because the type did not reach it.
 *
 * `mcpInventory` joined it (usetheokit/theokit#192) rather than getting a subpath of its own: it is
 * a projection OVER this sink, its only consumer is the same status UI, and a second entry point
 * would let the two versions of the same answer drift apart.
 */
export { createMcpHealthSink } from './bridge/mcp-health-sink.js'
export type {
  McpFailure,
  McpFailureSource,
  McpHealthSink,
  McpServerFailedEvent,
} from './bridge/mcp-health-sink.js'

export { mcpInventory } from './bridge/mcp-inventory.js'
export type { McpServerState, McpServerStatus } from './bridge/mcp-inventory.js'
