/**
 * B-088 — the sink that turns the SDK's run events into what `/mcp` reports.
 *
 * ## What this file used to prove, and why half of it is now unrepresentable
 *
 * The sink took `unknown` and read the payload field by field, so three of the five tests here
 * asserted that a MALFORMED event was ignored at runtime: `{ type: 'mcp_server_failed' }` with no
 * server name, then `undefined`, then a bare string. The docblock justified the structural read as
 * "so this file does not depend on which version of `@theokit/sdk` is installed".
 *
 * That justification was true, and it was the symptom. The payload was duck-checked because the
 * TYPE did not reach this layer — which is exactly the gap M82 closed. `RunEvent` is re-exported
 * from `@theokit/agents` now, so those three inputs no longer compile.
 *
 * They are kept as `@ts-expect-error` assertions rather than deleted. A test that a malformed event
 * is ignored at runtime and a test that it cannot be WRITTEN are about the same defect, and the
 * second is stronger: a runtime guard reports nothing when the shape moves, silently, while a type
 * error stops the build. Deleting them would lose the record of which shapes are refused.
 */
import { beforeEach, describe, expect, it } from 'vitest'

import { currentMcpFailures, startMcpFailureTurn } from '../../src/agent-session/mcp-failure-record.js'
import { mcpFailureSink } from '../../src/agent-session/mcp-failure-sink.js'

describe('B-088 — mcpFailureSink', () => {
  beforeEach(() => {
    // `startTurn` is the reset now: the framework clears run failures per turn and KEEPS config
    // warnings, which is a distinction the old module-level map could not express.
    startMcpFailureTurn()
  })

  it('records an mcp_server_failed event with its server and reason', () => {
    mcpFailureSink({
      type: 'mcp_server_failed',
      serverName: 'theo-mcp',
      message: 'spawn theo-mcp ENOENT',
    })

    expect(currentMcpFailures()).toEqual([
      // `source` is new and is the reason a config warning survives a turn boundary while this
      // does not. Asserted rather than ignored: a failure with no provenance is a row the panel
      // cannot explain.
      { serverName: 'theo-mcp', message: 'spawn theo-mcp ENOENT', source: 'run' },
    ])
  })

  it('ignores every other run event', () => {
    // The sink is handed the WHOLE RunEvent stream — tool_progress, rate_limit, permission_denied,
    // task_*, compact_boundary. Reacting to any of them would put unrelated noise in an MCP panel.
    mcpFailureSink({ type: 'tool_progress', toolName: 'shell', toolCallId: 'c1' })
    mcpFailureSink({ type: 'rate_limit', attempt: 1 })

    expect(currentMcpFailures()).toEqual([])
  })

  it('the same server failing twice in one turn is ONE broken server', () => {
    // The deduplication, which moved to the framework and must survive the move: two rows for one
    // server overstates the damage. The LATEST reason wins — it is the one an operator can act on.
    mcpFailureSink({ type: 'mcp_server_failed', serverName: 'theo-mcp', message: 'first' })
    mcpFailureSink({ type: 'mcp_server_failed', serverName: 'theo-mcp', message: 'second' })

    expect(currentMcpFailures()).toEqual([
      { serverName: 'theo-mcp', message: 'second', source: 'run' },
    ])
  })

  it('a turn boundary clears what the previous turn reported', () => {
    // A server that failed last turn may answer on the next one. Without the clear, the panel calls
    // a recovered server broken — the same class of lie the item was opened about.
    mcpFailureSink({ type: 'mcp_server_failed', serverName: 'theo-mcp', message: 'gone' })
    expect(currentMcpFailures()).toHaveLength(1)

    startMcpFailureTurn()

    expect(currentMcpFailures()).toEqual([])
  })

  it('a malformed event is now REFUSED BY THE TYPE, not filtered at runtime', () => {
    // The three inputs the runtime guard used to swallow. Each `@ts-expect-error` fails the build
    // if the shape ever becomes writable again — which is a stronger assertion than the one it
    // replaces, because a structural read that stops matching does not throw, it just goes quiet.

    // @ts-expect-error — `serverName` and `message` are required on the union member.
    expect(() => mcpFailureSink({ type: 'mcp_server_failed' })).toBeTypeOf('function')
    // @ts-expect-error — `message` is still missing.
    expect(() => mcpFailureSink({ type: 'mcp_server_failed', serverName: 'x' })).toBeTypeOf(
      'function',
    )
    // @ts-expect-error — not a RunEvent at all.
    expect(() => mcpFailureSink(undefined)).toBeTypeOf('function')

    // And nothing was recorded by the well-typed calls above, because none ran.
    expect(currentMcpFailures()).toEqual([])
  })
})
