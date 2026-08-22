import type { McpServersMap } from '../types.js'

import type { McpHealthSink } from './mcp-health-sink.js'

/**
 * What the agent's MCP servers are DOING — as far as this package can honestly know
 * (usetheokit/theokit#192).
 *
 * ## The distinction that made this worth building
 *
 * `loadMcpJson` reads the FILE. A `/mcp` command built on it shows what is *configured*, and that
 * is not the question a user opens the command to ask: they open it to find the server that failed
 * its handshake, or the one they wrote down that never came up. Configuration and state are
 * different facts, and only one of them is useful when something is wrong.
 *
 * ## Why a composition rather than a new read
 *
 * The handshake belongs to `@theokit/sdk`; nothing in this package ever connects to a server. But
 * the SDK already emits `mcp_server_failed` per failing server, and `createMcpHealthSink` already
 * turns that into state (M82). So the SERVER-level answer is a projection of two facts this package
 * already holds — `configured − failed = loaded` — rather than a second source of truth to keep in
 * sync with the first.
 *
 * The turn semantics deliberately are NOT re-derived here. A run failure is cleared by
 * `startTurn()`, and re-implementing that rule would give the ecosystem two copies of it to drift.
 * This function reads whatever the sink currently believes.
 *
 * ## What this does NOT answer, stated rather than implied
 *
 * **Which tools each server exposed.** That inventory exists only as the agent loop's resolved tool
 * table (`@theokit/sdk`, `internal/agent-loop/loop-types.ts`), the run-event union carries no
 * event for it, and this package cannot derive it: an MCP tool is only observable here once it is
 * CALLED, by its `mcp_<server>_<tool>` name, which reports use and not availability.
 *
 * Closing that half needs the SDK to emit the inventory — as an EVENT rather than a getter, because
 * the state is run-scoped: with `mcpLifecycle: 'run'` a server may not exist by the time a caller
 * asks, so a getter would have to answer about something already gone.
 */

/** What is known about one MCP server right now. */
export type McpServerStatus =
  /** In the configuration, and nothing has reported it failing. */
  | 'loaded'
  /** In the configuration, and the run reported it failing. */
  | 'failed'
  /** Written down by the user, and REFUSED by the loader — so it is in no configuration map. */
  | 'ignored'

export interface McpServerState {
  /** The server as named in `.mcp.json`, so a consumer can match it to a row it already shows. */
  readonly serverName: string
  readonly status: McpServerStatus
  /**
   * Why, when the status is not `loaded`.
   *
   * The reason is the actionable half: a red row with no message sends the operator to the logs for
   * something the framework already knows.
   */
  readonly message?: string
}

/**
 * Project the configured servers and the observed failures into one per-server status list.
 *
 * @param configured - what `loadMcpJson` returned.
 * @param health - the sink fed by `RunEvent`s and by `loadMcpJson`'s `onWarn`.
 * @returns configured servers in their declared order, then any server the loader refused.
 */
export function mcpInventory(
  configured: McpServersMap,
  health: McpHealthSink,
): readonly McpServerState[] {
  const failures = new Map(health.current().map((failure) => [failure.serverName, failure]))

  const states: McpServerState[] = Object.keys(configured).map((serverName) => {
    const failure = failures.get(serverName)
    if (failure === undefined) return { serverName, status: 'loaded' }
    return { serverName, status: 'failed', message: failure.message }
  })

  // A server the loader REFUSED is absent from `configured` — it never became a config entry. A
  // view built from the map alone would show nothing at all for a server the user wrote down,
  // which is the one case where saying nothing is worst.
  for (const [serverName, failure] of failures) {
    if (serverName in configured) continue
    states.push({ serverName, status: 'ignored', message: failure.message })
  }

  return states
}
