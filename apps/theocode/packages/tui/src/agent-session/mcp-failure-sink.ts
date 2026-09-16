import type { RunEvent } from '@theokit/agents'

import { sinkRunEvent } from './mcp-failure-record.js'

/**
 * B-088 — turns the SDK's run-event stream into what `/mcp` reports.
 *
 * The sink receives EVERY `RunEvent` (`tool_progress`, `rate_limit`, `permission_denied`, `task_*`,
 * `compact_boundary`, `tripwire`, `completion_check`, `mcp_server_failed`). Only the last one is
 * ours; reacting to any other would put unrelated noise in an MCP panel. The framework's sink does
 * that filtering — this function exists only to bind it to the process holder.
 *
 * ## What changed, and why it IS the milestone
 *
 * The previous version took `unknown` and read the payload FIELD BY FIELD — checking `e.type`, then
 * `typeof e.serverName === 'string'`, then `typeof e.message === 'string'` — with a docblock
 * explaining that this avoided pinning an SDK version. The explanation was true, and it was also the
 * symptom: the payload was duck-checked because the TYPE did not reach this layer.
 *
 * It reaches now. `RunEvent` is re-exported from `@theokit/agents`, so the parameter is the union
 * itself, and a contract change fails the build here instead of silently matching nothing at
 * runtime — which is what a structural read does when the shape moves: it does not throw, it just
 * quietly stops reporting.
 */
export function mcpFailureSink(event: RunEvent): void {
  sinkRunEvent(event)
}
