/**
 * M4 (theokit-ai-first) — deterministic HITL harness E2E (DoD-3).
 *
 * Drives the full pause → approve → tool-runs → done path and the deny path through the REAL
 * translator + registry, with the SDK stubbed (no LLM). The stub faithfully mirrors the SDK's
 * veto contract (`tool-dispatch.ts:225`): a `pre_tool_call` block makes the loop inject a denial
 * tool result (`Plugin blocked this tool call: <message>`) and CONTINUE — it never crashes. The
 * approval is resolved in-process via the same registry the approve route uses (ADR-M4a: the pause
 * is the SDK's own awaited hook, so this needs no HTTP round-trip).
 *
 * Known caveat (honest): `PreToolCallContext` carries no `toolCallId` (`plugins/types.ts:33`), so the
 * approval chunk is keyed by a fresh `approvalId`, distinct from the SDK's eventual tool-call id. The
 * approval is a standalone gate; the tool run surfaces its own output. Functionally: pause, approve,
 * run, done — and deny surfaces + continues.
 */
import 'reflect-metadata'
import { readUIMessageStream, type UIMessageChunk } from 'ai'
import { describe, expect, it, vi } from 'vitest'

interface FakeEvent {
  type: string
  [k: string]: unknown
}

/** Minimal shape of a reconstructed UIMessage part we assert on (ai yields richer objects). */
type ParsedPart = { type: string; state?: string; approval?: { id?: string } } & Record<
  string,
  unknown
>

/**
 * Replay already-collected chunks through ai's REAL `readUIMessageStream` — the exact reader
 * `useAgent` runs — and return the final assistant message's parts. This is what a renderer sees;
 * it is NOT the same as the raw chunk list (ai mutates a tool part to `state:'approval-requested'`
 * rather than surfacing a `tool-approval-request` part of its own).
 */
async function reconstructParts(
  chunks: { type: string; [k: string]: unknown }[],
): Promise<ParsedPart[]> {
  const stream = new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c as unknown as UIMessageChunk)
      controller.close()
    },
  })
  let parts: ParsedPart[] = []
  for await (const message of readUIMessageStream({ stream })) {
    parts = message.parts as ParsedPart[]
  }
  return parts
}

// The stub captures the injected HITL plugin from `overrides.plugins`, fires its `pre_tool_call`
// hook for a gated tool (which emits `approval_required` + AWAITS the human decision), then emits
// the tool run (allow) or the SDK's denial tool result (deny), then `done`.
const hoisted = vi.hoisted(() => ({ toolCallId: 'sdk-tool-1' }))

vi.mock('../../src/bridge/sdk-adapter.js', () => ({
  createSdkAgentStream:
    (
      _compiled: unknown,
      _tools: unknown,
      _apiKey: string,
      overrides: { plugins?: unknown[] } = {},
    ) =>
    (_message: string, _sessionId: string): AsyncIterable<FakeEvent> => ({
      async *[Symbol.asyncIterator]() {
        const plugin = overrides.plugins?.[0] as
          | { register: (ctx: { on: (h: string, fn: (c: unknown) => unknown) => void }) => void }
          | undefined
        let handler: ((c: unknown) => unknown) | undefined
        plugin?.register({
          on: (hook, fn) => {
            if (hook === 'pre_tool_call') handler = fn
          },
        })
        // The SDK fires pre_tool_call BEFORE dispatching the tool; the plugin emits approval_required
        // (synchronously) then returns a Promise the SDK loop awaits — a genuine pause.
        const decision = handler
          ? await handler({ name: 'ops.deploy', args: { env: 'prod' }, agentId: 'a', runId: 'r' })
          : undefined
        const callId = hoisted.toolCallId
        if (decision === undefined) {
          // Approved → the SDK dispatches the tool and streams its result.
          yield { type: 'tool_call', callId, toolName: 'ops.deploy', input: { env: 'prod' } }
          yield {
            type: 'tool_result',
            callId,
            toolName: 'ops.deploy',
            output: 'deployed',
            isError: false,
          }
        } else {
          // Denied → the SDK injects a denial tool result (tool-dispatch.ts:225) and CONTINUES.
          const message = (decision as { message: string }).message
          yield {
            type: 'tool_result',
            callId,
            toolName: 'ops.deploy',
            output: `Plugin blocked this tool call: ${message}`,
            isError: false,
          }
        }
        yield {
          type: 'done',
          result: 'ok',
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          durationMs: 1,
          cost: 0,
        }
      },
    }),
}))

const { streamAgentUIMessages } = await import('../../src/bridge/agent-endpoint.js')
const { createInProcessApprovalRegistry } =
  await import('../../../theo/src/server/agent/approval-registry.js')
const { Agent } = await import('../../src/decorators/agent.js')
const { MainLoop } = await import('../../src/decorators/main-loop.js')
const { Toolbox, Tool } = await import('../../src/decorators/tool.js')
const { HumanInTheLoop } = await import('../../src/decorators/human-in-the-loop.js')
const { walkAgentMetadata } = await import('../../src/bridge/walk-agent-metadata.js')
const { compileAgent } = await import('../../src/bridge/agent-compiler.js')
const { z } = await import('zod')

/** Build a compiled agent with one HITL-gated tool + the harness HITL wiring over a registry. */
function gatedAgentFixture() {
  @Toolbox({ namespace: 'ops' })
  class OpsTools {
    @Tool({ name: 'deploy', description: 'Deploy to prod', input: z.object({ env: z.string() }) })
    @HumanInTheLoop({ question: 'Deploy to prod?', onTimeout: 'abort' })
    async deploy(): Promise<string> {
      return 'deployed'
    }
  }
  @Agent({ name: 'ops', route: '/ops' })
  class OpsAgent {
    @MainLoop({ strategy: 'simple-chat' })
    async run(): Promise<void> {}
  }
  const compiled = compileAgent(
    walkAgentMetadata(OpsAgent, [OpsTools]),
    new Map([[OpsTools, new OpsTools()]]),
  )
  const registry = createInProcessApprovalRegistry()
  const gated = compiled.hitl
  if (!gated) throw new Error('fixture: expected a gated tool')
  const hitl = {
    gated,
    awaitApproval: (approvalId: string, opts: { timeout?: number; onTimeout?: string }) =>
      registry.register(approvalId, {
        timeoutMs: opts.timeout ?? 300_000,
        onTimeout: opts.onTimeout === 'proceed' ? ('proceed' as const) : ('abort' as const),
      }),
  }
  return { compiled, registry, hitl }
}

/** Consume the stream; when the approval-request chunk arrives, resolve it via the registry. */
async function runWithDecision(approved: boolean) {
  const { compiled, registry, hitl } = gatedAgentFixture()
  const chunks: { type: string; [k: string]: unknown }[] = []
  for await (const c of streamAgentUIMessages(compiled, 'k', {
    message: 'deploy please',
    sessionId: 's1',
    hitl,
  })) {
    chunks.push(c)
    if (c.type === 'tool-approval-request') {
      registry.resolve(c.approvalId as string, approved)
    }
  }
  return chunks
}

describe('HITL harness E2E (M4 / DoD-3)', () => {
  it('test_e2e_hitl_pause_approve_runs_tool_then_done', async () => {
    const chunks = await runWithDecision(true)

    // The gate surfaces as the ai-sdk-native approval-request chunk.
    const approval = chunks.find((c) => c.type === 'tool-approval-request')
    expect(approval).toBeDefined()
    expect(typeof approval?.approvalId).toBe('string')
    // Approved → the tool ran and its output reached the wire.
    expect(chunks.some((c) => c.type === 'tool-output-available' && c.output === 'deployed')).toBe(
      true,
    )
    // The stream terminates cleanly.
    expect(chunks.at(-1)).toEqual({ type: 'finish' })
  })

  it('test_e2e_hitl_deny_surfaces_denied_and_continues', async () => {
    const chunks = await runWithDecision(false)

    // The gate still surfaces.
    expect(chunks.some((c) => c.type === 'tool-approval-request')).toBe(true)
    // Denied → the SDK's denial tool result surfaces (the loop CONTINUED, it did not crash).
    expect(
      chunks.some(
        (c) =>
          c.type === 'tool-output-available' &&
          typeof c.output === 'string' &&
          (c.output as string).includes('denied by human approver'),
      ),
    ).toBe(true)
    // The stream still terminates cleanly (loop continued to completion).
    expect(chunks.at(-1)).toEqual({ type: 'finish' })
  })

  it('test_e2e_approval_surfaces_as_approval_requested_part_through_the_real_reader', async () => {
    // The client (`useAgent` → readUIMessageStream) must be able to FIND the pending approval. ai
    // reconstructs the `tool-approval-request` chunk by mutating the tool part to
    // `state: 'approval-requested'` with `approval.id` — it does NOT emit a `tool-approval-request`
    // part. This is exactly what the example page scans for; assert it through the real reader.
    const chunks = await runWithDecision(true)
    const parts = await reconstructParts(chunks)
    const pending = parts.find((p) => p.state === 'approval-requested')
    expect(pending, 'a tool part must reconstruct in approval-requested state').toBeDefined()
    expect(typeof pending?.approval?.id).toBe('string')
  })

  it('test_e2e_non_gated_agent_never_pauses', async () => {
    // A compiled agent with NO gated tool takes the M2 path — no approval chunk at all.
    @Agent({ name: 'plain', route: '/plain' })
    class PlainAgent {
      @MainLoop({ strategy: 'simple-chat' })
      async run(): Promise<void> {}
    }
    const compiled = compileAgent(walkAgentMetadata(PlainAgent))
    const chunks: { type: string; [k: string]: unknown }[] = []
    for await (const c of streamAgentUIMessages(compiled, 'k', {
      message: 'hi',
      sessionId: 's1',
    })) {
      chunks.push(c)
    }
    expect(chunks.some((c) => c.type === 'tool-approval-request')).toBe(false)
  })
})
