/**
 * `@theokit/agents/mcp-health` — M82: per-turn, per-server MCP health.
 *
 * A subpath rather than a member of the main barrel, for the reason the M76 bundle finding
 * established and this milestone re-measured (36 797 bytes against a 36 500 ceiling): an app that
 * only defines an agent should not carry the machinery for a UI that renders server status.
 *
 * The `RunEvent` union and the `McpServerFailedEvent` member DO cross from the main barrel — a type
 * costs zero bytes, and the whole point of the milestone is that a consumer had to duck-check the
 * payload because the type did not reach it.
 */
export { createMcpHealthSink } from './bridge/mcp-health-sink.js'
export type {
  McpFailure,
  McpFailureSource,
  McpHealthSink,
  McpServerFailedEvent,
} from './bridge/mcp-health-sink.js'
