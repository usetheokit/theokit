/**
 * theokit#189 — the in-process turn forwards `onRunEvent`.
 *
 * ## The defect
 *
 * `RunEvent` is the SDK's typed runtime-observability stream, and `@theokit/agents` threads its sink
 * to `SendOptions.onRunEvent` on the HTTP path (`agent-endpoint.ts`, theokit#132). The IN-PROCESS
 * entry point — the one an embedded terminal uses — declared no such field, so the sink had no way
 * in and every `RunEvent` was unobservable there.
 *
 * The shape is the one theokit#188 already produced once: a field that exists at both ends of a hop
 * and is dropped in the middle. `streamAgentUIMessages` accepts `onRunEvent`; the caller simply never
 * passed it. Nothing failed, because a sink nobody can install emits nothing to compare against.
 *
 * ## Why the oracle is the forwarded reference
 *
 * Asserting that "an event arrived" would need a real SDK run and a real failing MCP server, which
 * makes the test an integration test of someone else's package. The defect here is one hop wide, so
 * the oracle is that hop: the sink the caller supplied is the sink the stream is invoked with. A
 * regression that drops the field again fails this immediately, offline and deterministically.
 */
import { describe, expect, it } from 'vitest'

import { streamAgentTurnInProcess, type StreamAgentTurnDeps } from '../../src/in-process-turn.js'

/**
 * An already-compiled agent — the shape `isCompiledAgentOptions` accepts (`tools` array + `agents`
 * object), so the module never goes through definition compilation. This test never reaches the SDK,
 * only the boundary in front of it.
 */
const COMPILED = { default: { tools: [], agents: { probe: { instructions: 'probe' } } } }

function spyStream(): { deps: StreamAgentTurnDeps; seen: Record<string, unknown>[] } {
  const seen: Record<string, unknown>[] = []
  const deps = {
    stream: async function* (_compiled: unknown, _key: string, options: Record<string, unknown>) {
      seen.push(options)
      // The real stream yields wire chunks; this spy exists to observe the OPTIONS it was called
      // with, so it yields an empty sequence rather than fabricating frames nobody asserts on.
      yield* []
    } as unknown as StreamAgentTurnDeps['stream'],
  } as StreamAgentTurnDeps
  return { deps, seen }
}

async function drain(gen: AsyncGenerator): Promise<void> {
  for await (const _ of gen) {
    // the spy yields nothing; draining is what runs the generator body
  }
}

describe('theokit#189 — the in-process turn forwards the RunEvent sink', () => {
  it('hands the caller-supplied onRunEvent to the stream', async () => {
    const { deps, seen } = spyStream()
    const sink = (): void => {}

    await drain(
      streamAgentTurnInProcess(COMPILED, 'test-key', { message: 'hi', onRunEvent: sink }, deps),
    )

    expect(seen).toHaveLength(1)
    // The same reference, not merely something truthy: a wrapper that swallows events would pass a
    // truthiness check and still lose every event.
    expect(seen[0]?.onRunEvent).toBe(sink)
  })

  it('omits the key entirely when no sink is supplied, so the call is byte-identical to before', async () => {
    const { deps, seen } = spyStream()

    await drain(streamAgentTurnInProcess(COMPILED, 'test-key', { message: 'hi' }, deps))

    expect(seen).toHaveLength(1)
    expect('onRunEvent' in (seen[0] ?? {})).toBe(false)
  })
})
