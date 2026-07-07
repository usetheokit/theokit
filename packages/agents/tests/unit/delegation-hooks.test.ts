/**
 * M12 (theokit-ai-first) — delegation observability hooks on `delegate()`.
 *
 * ADR-0040 § D2: these are HOME/BOUNDARY observability hooks over the EXISTING delegation
 * primitive — they do not add a new orchestration engine (the SDK owns the loop). A supervisor
 * uses `onDelegationStart` to rewrite the sub-agent's input, and `onDelegationComplete` to
 * inspect / transform / veto the result. `abortSignal` propagation already exists (`opts.signal`).
 *
 * TDD RED-first. Uses an injected `streamFactory` so no LLM is called (the loop is exercised for real).
 */
import { describe, expect, it, vi } from 'vitest'

import type { StreamEvent } from '../../src/bridge/agent-sse-handler.js'
import type { DelegationResult } from '../../src/bridge/delegation-types.js'
import { delegate } from '../../src/bridge/agent-orchestrator.js'
import { Agent, MainLoop } from '../../src/decorators/index.js'

@Agent({ model: 'test-model' })
class EchoAgent {
  @MainLoop({ strategy: 'simple-chat', maxIterations: 1 })
  async run() {}
}

/** A factory that records the message it was given and streams a fixed text answer. */
function factoryRecording() {
  const seen: string[] = []
  const factory = (message: string): AsyncIterable<StreamEvent> => {
    seen.push(message)
    return (async function* () {
      yield { type: 'text_delta', content: 'ok' } as StreamEvent
      yield { type: 'done' } as StreamEvent
    })()
  }
  return { factory, seen }
}

describe('M12 — delegation hooks on delegate()', () => {
  it('onDelegationStart can REWRITE the sub-agent input before the run', async () => {
    const { factory, seen } = factoryRecording()
    const onDelegationStart = vi.fn(
      (ctx: { subAgent: string; input: string }) => `[persona] ${ctx.input}`,
    )

    await delegate(EchoAgent, 'do the task', {
      apiKey: 'k',
      streamFactory: factory,
      onDelegationStart,
    })

    expect(onDelegationStart).toHaveBeenCalledWith({ subAgent: 'EchoAgent', input: 'do the task' })
    // The rewritten input is what the loop actually ran with (round-1 prompt contains it).
    expect(seen[0]).toContain('[persona] do the task')
  })

  it('onDelegationComplete receives the result and can TRANSFORM it', async () => {
    const { factory } = factoryRecording()
    const onDelegationComplete = vi.fn((ctx: { subAgent: string; result: DelegationResult }) => ({
      ...ctx.result,
      response: ctx.result.response.toUpperCase(),
    }))

    const result = await delegate(EchoAgent, 'hi', {
      apiKey: 'k',
      streamFactory: factory,
      onDelegationComplete,
    })

    expect(onDelegationComplete).toHaveBeenCalledOnce()
    expect(result.response).toBe('OK')
  })

  it('runs unchanged when no hooks are provided (backward-compatible)', async () => {
    const { factory, seen } = factoryRecording()
    const result = await delegate(EchoAgent, 'plain', { apiKey: 'k', streamFactory: factory })
    expect(seen[0]).toContain('plain')
    expect(result.response).toBe('ok')
  })
})
