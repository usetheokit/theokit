import { describe, expect, it } from 'vitest'

import { createMcpHealthSink } from '../../src/bridge/mcp-health-sink.js'

/**
 * M82 — per-turn, per-server MCP health.
 *
 * ## Where the gap is
 *
 * MCP is the best-evidenced extraction win in the layer: `loadMcpJson` is a documented case of a
 * primitive that deleted product code, and it carries a security control a consumer structurally
 * could not have written — the field allowlist that strips `envPolicy`, so a version-controlled
 * `.mcp.json` cannot hand `ANTHROPIC_API_KEY` and the rest of the environment to a third-party
 * binary.
 *
 * What was missing is observability. The SDK emits `mcp_server_failed` as a `RunEvent`, and nothing
 * turned that into per-turn per-server STATE — so a consumer's sink read the payload
 * **structurally**, duck-checking fields to avoid pinning an SDK version. That is a sink
 * compensating for a typed surface that does not reach it.
 *
 * ## The two behaviours that are corrections, not taste
 *
 * Clearing per turn, and deduplicating by server name. Without either, a server that recovered is
 * still reported as broken — the UI shows a red light for a server that is answering.
 */

const failure = (serverName: string, message = 'spawn failed') =>
  ({ type: 'mcp_server_failed', serverName, message }) as const

describe('the sink turns events into per-server state', () => {
  it('test_a_failure_event_becomes_a_current_failure', () => {
    const health = createMcpHealthSink()
    health.sink(failure('github', 'handshake timeout'))
    expect(health.current()).toEqual([
      { serverName: 'github', message: 'handshake timeout', source: 'run' },
    ])
  })

  it('test_an_UNRELATED_run_event_is_ignored', () => {
    // Anti-vacuity: a sink that recorded everything would pass the test above while filling the UI
    // with tool-progress noise.
    const health = createMcpHealthSink()
    health.sink({ type: 'tool_progress', toolName: 'x' } as never)
    expect(health.current()).toEqual([])
  })

  it('test_the_same_server_failing_twice_is_ONE_entry', () => {
    // Deduplication is a correction, not taste: the SDK emits once per failing server per run, but a
    // turn can span retries, and a list that grows per attempt reports "three broken servers" for one.
    const health = createMcpHealthSink()
    health.sink(failure('github', 'first'))
    health.sink(failure('github', 'second'))
    expect(health.current()).toHaveLength(1)
  })

  it('test_the_LATEST_message_wins_for_a_repeated_server', () => {
    // The most recent reason is the one an operator can act on; the first is history.
    const health = createMcpHealthSink()
    health.sink(failure('github', 'first'))
    health.sink(failure('github', 'second'))
    expect(health.current()[0].message).toBe('second')
  })

  it('test_two_different_servers_are_two_entries', () => {
    const health = createMcpHealthSink()
    health.sink(failure('github'))
    health.sink(failure('linear'))
    expect(
      health
        .current()
        .map((f) => f.serverName)
        .sort((a, b) => a.localeCompare(b)),
    ).toEqual(['github', 'linear'])
  })
})

describe('startTurn — a recovered server stops being reported', () => {
  it('test_startTurn_clears_the_previous_turn', () => {
    // The other correction. Without the clear, a server that failed once is red forever, and the
    // operator learns to ignore the indicator — which is worse than not having it.
    const health = createMcpHealthSink()
    health.sink(failure('github'))
    health.startTurn()
    expect(health.current()).toEqual([])
  })

  it('test_a_server_that_fails_AGAIN_after_the_clear_is_reported_again', () => {
    // The counter-proof: clearing must not deafen the sink.
    const health = createMcpHealthSink()
    health.sink(failure('github'))
    health.startTurn()
    health.sink(failure('github', 'still down'))
    expect(health.current()).toEqual([
      { serverName: 'github', message: 'still down', source: 'run' },
    ])
  })
})

describe('onWarn — config-time and run-time failures reach ONE place', () => {
  it('test_a_loadMcpJson_warning_lands_in_the_same_list', () => {
    // "server X was ignored" (config time) and "server X failed to list" (run time) are the same
    // question for whoever is looking at the UI: is this server usable? Two channels means the
    // operator checks one and misses the other.
    const health = createMcpHealthSink()
    health.onWarn('server "github" ignored: unknown transport')
    expect(health.current()).toEqual([
      {
        serverName: 'github',
        message: 'server "github" ignored: unknown transport',
        source: 'config',
      },
    ])
  })

  it('test_a_warning_with_no_server_name_is_still_recorded', () => {
    // A warning the sink cannot attribute is still a warning. Dropping it because the name did not
    // parse is exactly the silent degradation this milestone is about.
    const health = createMcpHealthSink()
    health.onWarn('the mcp file is unparseable')
    expect(health.current()).toHaveLength(1)
    expect(health.current()[0].serverName).toBe('(unknown)')
  })

  it('test_config_warnings_survive_startTurn_because_they_are_not_per_turn', () => {
    // Honest asymmetry, stated: a run failure is about THIS turn, while a config warning is about
    // the file and remains true until the file changes. Clearing it every turn would make a
    // misconfigured server flicker.
    const health = createMcpHealthSink()
    health.onWarn('server "github" ignored: unknown transport')
    health.startTurn()
    expect(health.current()).toHaveLength(1)
  })
})
