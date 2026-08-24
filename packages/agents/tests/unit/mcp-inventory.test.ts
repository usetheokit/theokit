/**
 * What the agent's MCP servers are DOING, not what the file says (usetheokit/theokit#192).
 *
 * ## The distinction the issue is about
 *
 * `loadMcpJson` reads the FILE. A `/mcp` command built on it shows what is *configured*, which is
 * not what a user opens the command to see — they open it to find the server that failed the
 * handshake, or the one that is configured and never came up.
 *
 * ## What is answerable here, measured rather than assumed
 *
 * The handshake belongs to `@theokit/sdk`; this package never connects to a server. But the SDK
 * already emits `mcp_server_failed` per failing server, and `createMcpHealthSink` already turns
 * that into state (M82). So the SERVER-level answer is a composition of two things this package
 * already holds:
 *
 *   configured (loadMcpJson) − failed (health sink) = loaded
 *
 * The TOOL-level inventory is genuinely out of reach and stays that way: the resolved tool table
 * lives in the SDK's `internal/agent-loop/loop-types.ts`, and the run-event union carries no
 * inventory event. That residual is stated on the type rather than implied by its absence.
 */
import { describe, expect, it } from 'vitest'

import { createMcpHealthSink } from '../../src/bridge/mcp-health-sink.js'
import { mcpInventory } from '../../src/bridge/mcp-inventory.js'
import type { McpServersMap } from '../../src/types.js'

const CONFIGURED: McpServersMap = {
  github: { command: 'npx', args: ['-y', 'gh-mcp'] },
  postgres: { command: 'npx', args: ['-y', 'pg-mcp'] },
}

function failed(serverName: string, message: string) {
  return { type: 'mcp_server_failed' as const, serverName, message }
}

describe('a configured server nothing complained about is reported loaded', () => {
  it('test_every_configured_server_is_loaded_when_no_failure_was_observed', () => {
    const health = createMcpHealthSink()

    expect(mcpInventory(CONFIGURED, health)).toEqual([
      { serverName: 'github', status: 'loaded' },
      { serverName: 'postgres', status: 'loaded' },
    ])
  })
})

describe('a server the run reported failing is not reported loaded', () => {
  it('test_a_run_failure_marks_only_that_server_and_carries_its_reason', () => {
    const health = createMcpHealthSink()
    health.sink(failed('postgres', 'spawn ENOENT') as never)

    // The reason is the actionable half. A status with no message sends the operator to the logs
    // for something the framework already knows.
    expect(mcpInventory(CONFIGURED, health)).toEqual([
      { serverName: 'github', status: 'loaded' },
      { serverName: 'postgres', status: 'failed', message: 'spawn ENOENT' },
    ])
  })

  it('test_a_new_turn_clears_the_failure_because_the_health_sink_says_so', () => {
    const health = createMcpHealthSink()
    health.sink(failed('postgres', 'spawn ENOENT') as never)
    health.startTurn()

    // Deliberately NOT re-derived here: the turn semantics live in the health sink, and a second
    // copy of them would drift from it. This asserts the composition honours them.
    expect(mcpInventory(CONFIGURED, health)).toEqual([
      { serverName: 'github', status: 'loaded' },
      { serverName: 'postgres', status: 'loaded' },
    ])
  })
})

describe('a server the loader refused never reaches the map, and is still reported', () => {
  it('test_a_config_warning_appears_as_ignored_even_though_it_is_absent_from_the_config', () => {
    const health = createMcpHealthSink()
    health.onWarn('server "broken" ignored: missing command')

    // This is the case a `configured − failed` view would silently lose: the loader dropped the
    // entry, so it is in no map, and reporting only what loaded would show nothing at all for a
    // server the user wrote down.
    expect(mcpInventory(CONFIGURED, health)).toEqual([
      { serverName: 'github', status: 'loaded' },
      { serverName: 'postgres', status: 'loaded' },
      {
        serverName: 'broken',
        status: 'ignored',
        message: 'server "broken" ignored: missing command',
      },
    ])
  })

  it('test_an_unattributable_warning_is_still_surfaced', () => {
    const health = createMcpHealthSink()
    health.onWarn('the file could not be parsed')

    // The health sink keys these as `(unknown)` rather than dropping them. Losing it here would
    // reintroduce the silent degradation M82 removed, one layer up.
    const inventory = mcpInventory(CONFIGURED, health)
    expect(inventory.some((s) => s.serverName === '(unknown)' && s.status === 'ignored')).toBe(true)
  })
})
