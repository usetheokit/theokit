import type { RunEvent } from '@theokit/sdk'

/**
 * M82 — per-turn, per-server MCP health.
 *
 * ## The gap
 *
 * The SDK emits `mcp_server_failed` as a `RunEvent`, and nothing turned that into STATE. So a
 * consumer's sink read the payload **structurally** — duck-checking `type` and `serverName` — to
 * avoid pinning an SDK version. A sink doing that is compensating for a typed surface that does not
 * reach it, and the compensation silently stops working the day a field is renamed.
 *
 * ## Two behaviours that are corrections, not taste
 *
 * **Clear per turn.** A run failure is about THIS turn. Without the clear, a server that failed once
 * stays red forever, the operator learns to ignore the indicator, and the indicator becomes worse
 * than nothing.
 *
 * **Deduplicate by server name.** The SDK emits once per failing server per run, but a turn can span
 * retries — and a list that grows per attempt reports "three broken servers" for one.
 *
 * ## One channel, deliberately
 *
 * `loadMcpJson`'s `onWarn` drains here too. "server X was ignored" (config time) and "server X failed
 * to list" (run time) are the same question for whoever is looking: is this server usable? Two
 * channels means the operator checks one and misses the other.
 *
 * The asymmetry is stated rather than hidden: config warnings survive `startTurn`, because they are
 * about the FILE and stay true until it changes. Clearing them every turn would make a misconfigured
 * server flicker.
 */

/**
 * The `mcp_server_failed` member of the SDK's `RunEvent` union.
 *
 * Derived by DISCRIMINANT rather than imported by name: the SDK publishes the union but not the
 * member interface, and keying on `type` survives a rename of that interface — which importing the
 * name would not. One less thing that can drift without a red build.
 */
export type McpServerFailedEvent = Extract<RunEvent, { type: 'mcp_server_failed' }>

/** Where a failure was observed. */
export type McpFailureSource = 'run' | 'config'

/** One unusable MCP server, as the UI should show it. */
export interface McpFailure {
  /** The server as named in the MCP configuration, so a consumer can match it to what it lists. */
  readonly serverName: string
  /** Why — a spawn error, a handshake timeout, an ignored config entry. */
  readonly message: string
  readonly source: McpFailureSource
}

export interface McpHealthSink {
  /**
   * Feed a `RunEvent`. Anything that is not `mcp_server_failed` is ignored.
   *
   * Typed against the SDK's union rather than duck-checked — which is the point of the milestone:
   * the consumer was reading fields structurally precisely because this type did not reach it.
   */
  sink(event: RunEvent): void
  /** Feed a `loadMcpJson` warning. Same list, because it is the same question. */
  onWarn(message: string): void
  /** Begin a turn: clears run failures, keeps config warnings. */
  startTurn(): void
  /** The servers currently believed unusable. */
  current(): readonly McpFailure[]
}

/**
 * A server name inside a warning message, when one is quoted.
 *
 * `loadMcpJson` writes `server "github" ignored: …`. Reading the quoted name lets a config warning
 * be attributed to a row in the UI instead of floating unattached.
 */
const QUOTED_NAME = /server "([^"]+)"/

export function createMcpHealthSink(): McpHealthSink {
  // Keyed by server name — the deduplication IS the map.
  const runFailures = new Map<string, McpFailure>()
  const configFailures = new Map<string, McpFailure>()

  return {
    sink(event) {
      if (event.type !== 'mcp_server_failed') return
      // The latest reason wins: it is the one an operator can act on, and the first is history.
      runFailures.set(event.serverName, {
        serverName: event.serverName,
        message: event.message,
        source: 'run',
      })
    },

    onWarn(message) {
      // A warning the sink cannot attribute is still a warning. Dropping it because the name did not
      // parse is exactly the silent degradation this milestone exists to end.
      const serverName = QUOTED_NAME.exec(message)?.[1] ?? '(unknown)'
      configFailures.set(serverName, { serverName, message, source: 'config' })
    },

    startTurn() {
      runFailures.clear()
    },

    current() {
      return [...runFailures.values(), ...configFailures.values()]
    },
  }
}
