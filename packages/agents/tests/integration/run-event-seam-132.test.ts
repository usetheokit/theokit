/**
 * theokit#132 — the bridge exposes no seam for the SDK's typed `RunEvent`s.
 *
 * `SendOptions.onRunEvent` exists in the SDK and carries nine typed events — `tool_progress`,
 * `rate_limit`, `permission_denied`, `task_*`, `compact_boundary`, `tripwire`, `completion_check`.
 * The bridge never accepts a sink for them, so a consumer that needs live run observability has no
 * way to get it: theokit-studio's M1 event inspector degrades to `{kind:"message"}` and pins that
 * degraded contract with a test of its own.
 *
 * The fix is option (a) from the report — the minimal diff. The sink is threaded, not multiplexed
 * into the UIMessage stream: `RunEvent`s are diagnostics for an inspector, and folding them into
 * the message protocol would force every consumer of the chat stream to know about frames it has
 * no use for. Threading keeps the chat path byte-identical for anyone who does not opt in.
 *
 * These tests assert the WHOLE path — sink handed to the bridge, sink present on the `SendOptions`
 * the SDK actually receives — because a seam that stops one call short of `agent.send` is exactly
 * as useful as no seam at all, and would still typecheck.
 */
import { describe, expect, it, vi } from 'vitest'

interface SdkMsg {
  type: string
  [k: string]: unknown
}

const h = vi.hoisted(() => ({
  /** Every `SendOptions` the fake SDK received — the oracle for "did the sink actually arrive?". */
  sendOptions: [] as Record<string, unknown>[],
  messages: [] as SdkMsg[],
}))

vi.mock('@theokit/sdk', () => ({
  Agent: {
    getOrCreate: () =>
      Promise.resolve({
        send: (_msg: string, opts?: Record<string, unknown>) => {
          h.sendOptions.push(opts ?? {})
          return Promise.resolve({
            stream: async function* () {
              for (const m of h.messages) yield m
            },
            wait: async () => ({ result: 'final', usage: { inputTokens: 1, outputTokens: 1 } }),
          })
        },
        dispose: () => Promise.resolve(),
      }),
  },
  Tool: { create: (spec: unknown) => spec },
}))

const { createSdkAgentStream } = await import('../../src/bridge/sdk-adapter.js')
const { streamAgentUIMessages } = await import('../../src/bridge/agent-endpoint.js')

const COMPILED = {
  name: 'echo',
  instructions: 'echo',
  model: 'test/model',
  tools: [],
} as never

async function drain(gen: AsyncIterable<unknown>): Promise<void> {
  for await (const _ of gen) {
    // The events themselves are not the subject here; the SendOptions are.
  }
}

describe('theokit#132 — the RunEvent sink reaches the SDK', () => {
  it('test_on_run_event_is_threaded_into_send_options', async () => {
    h.sendOptions.length = 0
    h.messages = [{ type: 'status', agent_id: 'a', run_id: 'r', status: 'FINISHED' }]
    const sink = vi.fn()

    await drain(createSdkAgentStream(COMPILED, [], 'key', { onRunEvent: sink })('hi', 's1'))

    expect(h.sendOptions, 'the SDK was never sent anything').toHaveLength(1)
    expect(
      h.sendOptions[0]!.onRunEvent,
      'the sink stopped short of `agent.send` — a seam that does not reach the SDK is not a seam',
    ).toBe(sink)
  })

  it('test_without_a_sink_send_options_carry_no_on_run_event', async () => {
    // Back-compat floor: the chat path must stay byte-identical for consumers that do not opt in.
    // An `onRunEvent: undefined` key riding along would still be a change to what the SDK receives.
    h.sendOptions.length = 0
    h.messages = [{ type: 'status', agent_id: 'a', run_id: 'r', status: 'FINISHED' }]

    await drain(createSdkAgentStream(COMPILED, [], 'key', {})('hi', 's1'))

    expect(h.sendOptions).toHaveLength(1)
    expect(Object.keys(h.sendOptions[0]!)).not.toContain('onRunEvent')
  })

  it('test_the_sink_receives_what_the_sdk_emits', async () => {
    // Proves the sink is live rather than merely stored: the fake SDK invokes it exactly as the
    // real one does, and the consumer sees the typed event unchanged.
    h.sendOptions.length = 0
    h.messages = [{ type: 'status', agent_id: 'a', run_id: 'r', status: 'FINISHED' }]
    const received: unknown[] = []

    await drain(
      createSdkAgentStream(COMPILED, [], 'key', {
        onRunEvent: (e: unknown) => received.push(e),
      })('hi', 's1'),
    )

    const sink = h.sendOptions[0]!.onRunEvent as (e: unknown) => void
    sink({ type: 'tool_progress', runId: 'r', toolName: 'read', progress: 0.5 })
    expect(received).toEqual([
      { type: 'tool_progress', runId: 'r', toolName: 'read', progress: 0.5 },
    ])
  })

  it('test_the_seam_is_reachable_from_the_PUBLIC_entry_point', async () => {
    // `createSdkAgentStream` is internal. The issue names `StreamAgentOptions`, and that is what a
    // consumer actually holds — theokit-studio calls `streamAgentUIMessages`, not the adapter. A seam
    // wired only on the internal function would satisfy the tests above and still leave the reported
    // problem exactly where it was.
    h.sendOptions.length = 0
    h.messages = [{ type: 'status', agent_id: 'a', run_id: 'r', status: 'FINISHED' }]
    const sink = vi.fn()

    await drain(
      streamAgentUIMessages(COMPILED, 'key', {
        message: 'hi',
        sessionId: 's1',
        onRunEvent: sink,
      }),
    )

    expect(h.sendOptions).toHaveLength(1)
    expect(
      h.sendOptions[0]!.onRunEvent,
      'the public entry point accepts the sink but never forwards it',
    ).toBe(sink)
  })
})
