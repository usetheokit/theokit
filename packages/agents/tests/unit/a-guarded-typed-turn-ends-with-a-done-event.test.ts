/**
 * A guarded typed turn ends its stream with `done`, carrying the run's guarded result and usage.
 *
 * The guarded turn's stream yields the guarded text and no FINISHED status, so the typed adapter
 * emitted no terminal event at all. Driven through the public `toTypedAgentFactory` with output
 * guardrails enabled.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@theokit/sdk', () => ({
  Agent: {
    getOrCreate: () =>
      Promise.resolve({
        agentId: 'a1',
        send: () =>
          Promise.resolve({
            wait: () =>
              Promise.resolve({
                result: 'a BANANA reply',
                usage: { totalTokens: 42 },
                status: 'finished',
              }),
          }),
        dispose: () => Promise.resolve(),
      }),
  },
  Tool: { create: (spec: unknown) => spec },
}))

const { toTypedAgentFactory } = await import('../../src/bridge/sdk-adapter.js')
import type { AgentStreamEvent } from '../../src/bridge/agent-stream-events.js'
import type { Guardrail } from '../../src/guardrails/index.js'

const APPROVALS = {
  kind: 'auto-approve' as const,
  confinedBy: { mode: 'workspace-write' as const, enforced: true, detail: 'test double: enforced' },
  reason: 'test surface',
}

const redactor: Guardrail = {
  name: 'redact-banana',
  checkOutput: (text) => ({ action: 'redact', text: text.replaceAll('BANANA', '[REDACTED]') }),
}

describe('a guarded typed turn', () => {
  it('test_ends_with_a_done_event_holding_the_guarded_result_and_usage', async () => {
    const def = { name: 's', model: 'test/model', system: 'x', guardrails: [redactor] } as never
    const handle = await toTypedAgentFactory(def, { apiKey: 'key', approvals: APPROVALS })('s1')
    const turn = await handle.send('hi')
    const events: AgentStreamEvent[] = []
    for await (const e of turn.stream?.() ?? []) events.push(e)

    expect(events.map((e) => e.type)).toEqual(['text_delta', 'done'])
    const done = events[1]
    if (done?.type !== 'done') throw new Error('no done event')
    expect(done.result).toBe('a [REDACTED] reply')
    expect(done.usage.totalTokens).toBe(42)
  })
})
