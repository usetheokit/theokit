import { createMcpHealthSink, type McpFailure } from '@theokit/agents/mcp-health'

/**
 * B-088 — where the TUI keeps the MCP servers that did not answer during the current turn.
 *
 * The mechanism — the map keyed by server name, the per-turn clear, the deduplication — moved to
 * `@theokit/agents/mcp-health` (M82). What remains here is the PROCESS HOLDER: there is exactly one
 * agent in this process, the value changes outside render, and threading it through React state
 * would make it pretend to change during one. That decision belongs to the surface, and the
 * framework says so explicitly — whoever owns the process decides where the shared instance lives.
 *
 * What came back is more than what left. The framework's sink is typed against the SDK's `RunEvent`
 * — which was the point of the milestone: this module read the payload STRUCTURALLY
 * (`e.type !== 'mcp_server_failed'`, `typeof e.serverName !== 'string'`) precisely because the type
 * did not reach it. And every failure now carries `source: 'run' | 'config'`, which lets
 * `startTurn()` clear what belonged to the turn while KEEPING a configuration warning — a
 * distinction the local map could not make, and one that matters: a server ignored by config is
 * still ignored on the next turn.
 */
let health = createMcpHealthSink()

export type { McpFailure }

/**
 * Tests only — the holder outlives a single test otherwise.
 *
 * Kept from the module this replaced, and the migration is what proved it was not ceremony:
 * `startTurn()` deliberately KEEPS config warnings, so it is not a reset, and a warning recorded by
 * one test leaked into the next until this existed again. The framework being a FACTORY is what
 * makes the fix one line — a fresh instance rather than a `clear()` the interface does not offer.
 */
export function resetMcpFailures(): void {
  health = createMcpHealthSink()
}

/** Called when a turn begins — see the note on lifetime above. */
export function startMcpFailureTurn(): void {
  health.startTurn()
}

export function currentMcpFailures(): readonly McpFailure[] {
  return health.current()
}

/** `loadMcpJson`'s warning channel drains here: it is the same question, in one place. */
export function recordMcpWarning(message: string): void {
  health.onWarn(message)
}

/**
 * Feed a run event into the current holder.
 *
 * A FUNCTION, not `export const mcpHealth = health`. That binding would capture the instance live at
 * module evaluation, and `resetMcpFailures` reassigns — so after a reset the sink would keep writing
 * into an instance nobody reads while the panel reported an empty list. Reading `health` at call
 * time is what keeps the two halves looking at the same map.
 */
export function sinkRunEvent(event: Parameters<typeof health.sink>[0]): void {
  health.sink(event)
}
