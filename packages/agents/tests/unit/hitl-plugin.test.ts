/**
 * M4 (theokit-ai-first) — createHitlPlugin: the async `pre_tool_call` HITL producer.
 *
 * When a HITL-gated tool is about to run, the plugin emits an `ApprovalRequiredEvent` and
 * RETURNS A PROMISE the SDK loop awaits (`manager.ts:122` `await h(ctx)`) — a genuine pause. On
 * approve it resolves `undefined` (allow); on deny it resolves `{ block: true, message }` (the
 * SDK veto — the loop surfaces a tool result the model self-corrects on). A non-gated tool passes
 * through untouched. This is the adapter seam (ADR 0038) — no LLM call, no loop reimplementation.
 */
import { describe, expect, it, vi } from 'vitest'

import type { ApprovalRequiredEvent } from '../../src/bridge/agent-stream-events.js'
import { createHitlPlugin, type HitlWiring } from '../../src/bridge/hitl-plugin.js'

interface PreToolCallContext {
  name: string
  args: Record<string, unknown>
  agentId: string
  runId: string
}
type PreToolHandler = (c: PreToolCallContext) => unknown

/** Register the plugin against a fake PluginContext and return the captured pre_tool_call handler. */
function captureHandler(wiring: HitlWiring): PreToolHandler {
  let handler: PreToolHandler | undefined
  const ctx = {
    on: (hook: string, h: PreToolHandler) => {
      if (hook === 'pre_tool_call') handler = h
    },
  }
  createHitlPlugin(wiring).register(ctx)
  if (!handler) throw new Error('plugin did not register a pre_tool_call handler')
  return handler
}

const CTX = (name: string): PreToolCallContext => ({
  name,
  args: { env: 'prod' },
  agentId: 'a1',
  runId: 'r1',
})

describe('createHitlPlugin (M4)', () => {
  it('test_passes_through_non_gated_tool_untouched', async () => {
    const emit = vi.fn()
    const handler = captureHandler({
      gated: new Map(),
      emit,
      awaitApproval: async () => true,
    })
    const decision = await handler(CTX('safe.tool'))
    expect(decision).toBeUndefined()
    expect(emit).not.toHaveBeenCalled()
  })

  it('test_gated_tool_emits_approval_required_and_allows_on_approve', async () => {
    const emitted: ApprovalRequiredEvent[] = []
    const handler = captureHandler({
      gated: new Map([['ops.deploy', { question: 'Deploy to prod?' }]]),
      emit: (e) => emitted.push(e),
      awaitApproval: async () => true, // approved
    })
    const decision = await handler(CTX('ops.deploy'))
    expect(decision).toBeUndefined() // allow
    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({
      type: 'approval_required',
      toolName: 'ops.deploy',
      question: 'Deploy to prod?',
      input: { env: 'prod' },
    })
    expect(typeof emitted[0].callId).toBe('string')
  })

  it('test_gated_tool_blocks_on_deny', async () => {
    const handler = captureHandler({
      gated: new Map([['ops.deploy', { question: 'ok?' }]]),
      emit: () => {},
      awaitApproval: async () => false, // denied
    })
    const decision = await handler(CTX('ops.deploy'))
    expect(decision).toMatchObject({ block: true })
    expect((decision as { message: string }).message).toMatch(/deni/i)
  })

  it('test_two_gated_calls_get_distinct_approval_ids', async () => {
    const emitted: ApprovalRequiredEvent[] = []
    const handler = captureHandler({
      gated: new Map([['ops.deploy', { question: 'ok?' }]]),
      emit: (e) => emitted.push(e),
      awaitApproval: async () => true,
    })
    await Promise.all([handler(CTX('ops.deploy')), handler(CTX('ops.deploy'))])
    expect(emitted).toHaveLength(2)
    expect(emitted[0].callId).not.toBe(emitted[1].callId)
  })

  it('test_passes_the_approvalId_to_awaitApproval', async () => {
    const seen: string[] = []
    const handler = captureHandler({
      gated: new Map([['ops.deploy', { question: 'ok?' }]]),
      emit: (e) => seen.push(e.callId),
      awaitApproval: async (approvalId) => {
        seen.push(approvalId)
        return true
      },
    })
    await handler(CTX('ops.deploy'))
    // The emitted callId and the awaited approvalId are the same id.
    expect(seen[0]).toBe(seen[1])
  })
})
