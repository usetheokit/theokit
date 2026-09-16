/**
 * B-088 (final layer) — what the TUI knows about MCP servers that did not answer.
 *
 * ## What this file tests now
 *
 * The map, the per-turn clear and the deduplication moved to `@theokit/agents/mcp-health` (M82) and
 * are covered where they live, plus once through the sink in `mcp-failure-sink.test.ts`. Repeating
 * them here would be testing the framework from a consumer, which pins nothing this product owns.
 *
 * What this module owns after the move is the PROCESS HOLDER and the second input the framework's
 * sink accepts and the old local record could not: `loadMcpJson`'s warning channel. That channel is
 * the reason the move was worth making, so it is what these tests exercise.
 */
import { beforeEach, describe, expect, it } from 'vitest'

import {
  currentMcpFailures,
  recordMcpWarning,
  resetMcpFailures,
  startMcpFailureTurn,
} from '../../src/agent-session/mcp-failure-record.js'
import { mcpFailureSink } from '../../src/agent-session/mcp-failure-sink.js'

describe('B-088 — the MCP failure record', () => {
  beforeEach(() => {
    // `resetMcpFailures`, not `startMcpFailureTurn`. The turn boundary deliberately KEEPS config
    // warnings — which is the behaviour under test three cases down — so it is not isolation. A
    // warning from one test leaked into the next until this distinction was made explicit.
    resetMcpFailures()
  })

  it('is empty before anything failed', () => {
    // Anti-vacuity floor for everything below: a holder that always reported something would make
    // the assertions pass for the wrong reason.
    expect(currentMcpFailures()).toEqual([])
  })

  it('a config warning reaches the same list a run failure does', () => {
    // The whole point of the single channel: "server X was ignored" (config time) and "server X
    // failed to list" (run time) are the same question for a user reading `/mcp`, and used to land
    // in two different places — one of which had no place at all.
    recordMcpWarning('server "github" ignored: unknown field')

    const failures = currentMcpFailures()
    expect(failures).toHaveLength(1)
    expect(failures[0].serverName).toBe('github')
    expect(failures[0].source).toBe('config')
  })

  it('a turn boundary clears the RUN failure and KEEPS the config warning', () => {
    // The distinction the local map could not make, and the reason this is not just a rename. A
    // server that failed to answer may answer next turn — a server the config ignored is still
    // ignored, and clearing it would tell the user a problem went away by itself.
    recordMcpWarning('server "github" ignored: unknown field')
    mcpFailureSink({ type: 'mcp_server_failed', serverName: 'theo-mcp', message: 'ENOENT' })
    expect(currentMcpFailures()).toHaveLength(2)

    startMcpFailureTurn()

    const after = currentMcpFailures()
    expect(after).toHaveLength(1)
    expect(after[0]).toMatchObject({ serverName: 'github', source: 'config' })
  })

  it('the holder is shared across the modules that read it', () => {
    // The one thing the surface still owns: a single instance per process. Feeding through the sink
    // and reading through the record must see the same state, or the panel and the transport would
    // be looking at two different maps — which is the bug a module-level holder exists to prevent.
    mcpFailureSink({ type: 'mcp_server_failed', serverName: 'shared', message: 'seen' })

    expect(currentMcpFailures().map((f) => f.serverName)).toEqual(['shared'])
  })
})
