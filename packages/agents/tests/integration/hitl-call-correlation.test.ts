/**
 * usetheokit/theokit#361 — a HITL-gated tool is ONE call on the wire, under one id.
 *
 * ## What this pins, and why the translator's own unit suite could not
 *
 * `present-ui-message-stream.test.ts` was green throughout the defect, and correctly so: the two
 * emission sites are each self-consistent, and nothing in that suite drives them from the same run.
 * The double emission only exists when the SDK's runtime tool-call id and the HITL plugin's approval
 * id describe the same call — which requires both producers, the merge queue that interleaves them,
 * and the translator downstream of both.
 *
 * So these tests mock ONLY `@theokit/sdk` and assert on what crosses the served boundary. The real
 * `createSdkAgentStream`, `event-translator`, `sdk-timeline`, `presentUIMessageStream` and
 * `streamAgentUIMessages` run — the last being what `mountAgent` calls — and the last test drives
 * the wire through the framework's real span translator, which is the consumer the issue was filed
 * from.
 *
 * ## The fake SDK is shaped after the published one, not after what would be convenient
 *
 * Every ordering decision below was read from `@theokit/sdk@4.52.1`'s shipped `chunk-*.js`:
 *
 * - `dispatchSingleCall` mints `callId` and pushes the `tool_call` (`status: 'running'`) event
 *   BEFORE awaiting `vetoFromPluginPreHook`. The runtime id therefore exists during the pause, and
 *   a fake that emitted it after the resume would be testing a system nobody ships.
 * - `runPreToolCallHooks` awaits each handler in registration order and takes the first
 *   `{ block: true }` as the veto.
 * - `PreToolCallContext` is built by hand as `{ name, args, agentId, runId }` — no tool-call id.
 *   That absence is the whole reason the plugin mints its own id, so the fake must not leak one.
 * - a veto pushes `tool_call` (`status: 'completed'`) with `stderr` = the message and exit code 126.
 * - `mapWithConcurrency` dispatches several calls of one round concurrently, so a second call of the
 *   same gated tool pushes its `running` event while the first is still parked in its hook.
 *
 * The message shapes are `buildToolUseRunning` / `buildToolUseCompleted` verbatim.
 */
import 'reflect-metadata'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WireChunk } from '@theokit/presenter/wire'

import type {
  ObservabilityAdapter,
  SpanAttributes,
} from '../../../theo/src/server/observability/adapters/types.js'

/** How the fake run behaves — set per test, read inside the hoisted SDK mock. */
const h = vi.hoisted(() => ({
  /** Milliseconds the fake loop spends before the gated tool is dispatched (pre-pause run time). */
  beforeDispatchMs: 0,
  /**
   * Let the runtime `tool_call` reach the wire BEFORE the plugin emits its approval.
   *
   * Both are true orderings of the same SDK. The runtime event is pushed first but travels through
   * the translator and the merge queue, while the plugin's `emit` pushes into that queue directly —
   * so which one a consumer sees first is decided by microtask scheduling, and measured, the
   * approval usually wins. A correlation that only worked in the measured order would be relying on
   * that scheduling, so both orders are driven here.
   */
  runtimeCallFirst: false,
  /** Dispatch TWO calls of the same gated tool in one round, as `mapWithConcurrency` does. */
  concurrentCalls: false,
}))

const tick = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function createFakeRun(options: { plugins?: unknown[] }): {
  events: () => AsyncGenerator
  wait: () => Promise<Record<string, unknown>>
} {
  const timeline: unknown[] = []
  let terminated = false
  let notify: () => void = () => {}
  let wake = new Promise<void>((resolve) => {
    notify = resolve
  })
  const push = (message: Record<string, unknown>): void => {
    timeline.push({ kind: 'message', message })
    const wakeUp = notify
    wake = new Promise<void>((resolve) => {
      notify = resolve
    })
    wakeUp()
  }

  // The SDK's PluginManager: `await plugin.register(ctx)`, handlers kept in registration order.
  const hooks: ((ctx: unknown) => unknown)[] = []
  for (const plugin of options.plugins ?? []) {
    ;(
      plugin as { register: (ctx: { on: (n: string, f: (c: unknown) => unknown) => void }) => void }
    ).register({
      on: (name, handler) => {
        if (name === 'pre_tool_call') hooks.push(handler)
      },
    })
  }

  const running = (callId: string): Record<string, unknown> => ({
    type: 'tool_call',
    agent_id: 'agent-1',
    run_id: 'run-1',
    call_id: callId,
    name: 'ops_deploy',
    status: 'running',
    args: { env: 'prod' },
  })
  const completed = (
    callId: string,
    result: { stdout: string; stderr: string; exitCode: number },
  ): Record<string, unknown> => ({
    type: 'tool_call',
    agent_id: 'agent-1',
    run_id: 'run-1',
    call_id: callId,
    name: 'ops_deploy',
    status: 'completed',
    args: { env: 'prod' },
    result,
  })

  /** `dispatchSingleCall` for one gated call: announce, then park in the awaited veto hook. */
  async function dispatch(callId: string): Promise<void> {
    push(running(callId))
    if (h.runtimeCallFirst) await tick(5)
    let veto: { block: true; message: string } | undefined
    for (const hook of hooks) {
      const decision = (await hook({
        name: 'ops_deploy',
        args: { env: 'prod' },
        agentId: 'agent-1',
        runId: 'run-1',
      })) as { block?: boolean; message: string } | undefined
      if (decision?.block === true) {
        veto = decision as { block: true; message: string }
        break
      }
    }
    push(
      completed(
        callId,
        veto === undefined
          ? { stdout: 'deployed', stderr: '', exitCode: 0 }
          : { stdout: '', stderr: veto.message, exitCode: 126 },
      ),
    )
  }

  void (async () => {
    if (h.beforeDispatchMs > 0) await tick(h.beforeDispatchMs)
    if (h.concurrentCalls) await Promise.all([dispatch('call_sdk-1'), dispatch('call_sdk-2')])
    else await dispatch('call_sdk-1')
    terminated = true
    notify()
  })()

  return {
    events: async function* () {
      let index = 0
      while (!terminated) {
        while (index < timeline.length) yield timeline[index++]
        if (terminated) break
        await wake
      }
      while (index < timeline.length) yield timeline[index++]
    },
    wait: async () => ({ result: 'ok', usage: { inputTokens: 1, outputTokens: 2 } }),
  }
}

vi.mock('@theokit/sdk', () => ({
  Tool: { create: (spec: unknown) => spec },
  Agent: {
    getOrCreate: vi.fn(async (id: string, options: { plugins?: unknown[] }) => ({
      agentId: id,
      send: async () => createFakeRun(options),
      dispose: async () => {},
    })),
  },
}))

const { streamAgentUIMessages } = await import('../../src/bridge/agent-endpoint.js')
const { createInProcessApprovalRegistry } =
  await import('../../../theo/src/server/agent/approval-registry.js')
const { observeAgentRun } = await import('../../../theo/src/server/agent/observe-agent-run.js')
const { z } = await import('zod')
const { applyCapabilities } = await import('../../src/capability/capability.js')
const { ToolboxCapability } = await import('../../src/capability/toolbox.js')

/** A compiled agent with one `@HumanInTheLoop` tool, plus the harness wiring over a real registry. */
function gatedAgent() {
  class OpsTools {
    static readonly tools = [
      {
        name: 'deploy',
        description: 'Deploy to prod',
        input: z.object({ env: z.string() }),
        method: 'deploy',
        hitl: { question: 'Deploy to prod?', onTimeout: 'abort' as const },
      },
    ]
    async deploy(): Promise<string> {
      return 'deployed'
    }
  }
  const compiled = applyCapabilities([new ToolboxCapability(new OpsTools(), { namespace: 'ops' })])
  const gated = compiled.hitl
  if (gated === undefined) throw new Error('fixture: expected a gated tool')
  const registry = createInProcessApprovalRegistry()
  return {
    compiled,
    registry,
    hitl: {
      gated,
      awaitApproval: (approvalId: string, opts: { timeout?: number; onTimeout?: string }) =>
        registry.register(approvalId, {
          timeoutMs: opts.timeout ?? 300_000,
          onTimeout: opts.onTimeout === 'proceed' ? ('proceed' as const) : ('abort' as const),
        }),
    },
  }
}

/** Drive a served run, answering every approval after `humanDelayMs`. Returns the wire. */
async function runGated(options: {
  approve: boolean
  humanDelayMs?: number
}): Promise<WireChunk[]> {
  const { compiled, registry, hitl } = gatedAgent()
  const chunks: WireChunk[] = []
  for await (const chunk of streamAgentUIMessages(compiled, 'test-key', {
    message: 'deploy please',
    sessionId: `sess-${Math.random()}`,
    hitl,
    // #390 masks a failure's text before it reaches a browser. These cases assert WHICH chunk a
    // failure produces and under which id — not what it says — so they opt out explicitly.
    onError: (e) => e.message,
  })) {
    chunks.push(chunk)
    if (chunk.type === 'tool-approval-request') {
      const approvalId = chunk.approvalId
      setTimeout(() => registry.resolve(approvalId, options.approve), options.humanDelayMs ?? 0)
    }
  }
  return chunks
}

function idsOf(chunks: WireChunk[], type: string): string[] {
  return chunks
    .filter((c) => c.type === type)
    .map((c) => (c as unknown as { toolCallId: string }).toolCallId)
}

/**
 * The ids the wire reported a RESULT under, whichever way the call ended.
 *
 * usetheokit/theokit#388 split the result chunk in two: a call the SDK reports with a non-zero exit
 * code now emits `tool-output-error` instead of `tool-output-available`. A denial is exactly that —
 * `vetoFromPluginPreHook` completes the call with exit code 126 — so the denied path below moved
 * from one chunk type to the other. The claim THIS file makes is about identity, not about which
 * chunk carries it, so it reads both and keeps asserting the thing it was written to assert.
 */
function resultIds(chunks: WireChunk[]): string[] {
  return [...idsOf(chunks, 'tool-output-available'), ...idsOf(chunks, 'tool-output-error')]
}

describe('theokit#361 a gated tool call is one call on the wire', () => {
  beforeEach(() => {
    h.beforeDispatchMs = 0
    h.runtimeCallFirst = false
    h.concurrentCalls = false
  })

  it('test_a_gated_call_is_announced_once_and_its_result_carries_the_same_id', async () => {
    // The reported defect, as an assertion: two `tool-input-available` chunks under two ids for one
    // logical call, so a consumer counting tool calls counted two and a consumer correlating the
    // pause with the resume never correlated.
    const chunks = await runGated({ approve: true })

    const announced = idsOf(chunks, 'tool-input-available')
    expect(announced).toHaveLength(1)
    expect(idsOf(chunks, 'tool-output-available')).toEqual(announced)
  })

  it('test_the_approval_chunk_names_the_call_it_gates', async () => {
    // `tool-approval-request` was always shaped for this — `approvalId` is what a human answers
    // with, `toolCallId` is the call it gates. Both held the approval id, so the second field said
    // nothing the first did not.
    const chunks = await runGated({ approve: true })

    const approval = chunks.find((c) => c.type === 'tool-approval-request')
    const [announced] = idsOf(chunks, 'tool-input-available')
    expect(approval).toBeDefined()
    expect((approval as unknown as { toolCallId: string }).toolCallId).toBe(announced)
  })

  it('test_the_callback_url_id_still_travels_as_the_approval_id', async () => {
    // The plugin published `approve/${approvalId}` before any of this ran (`hitl-plugin.ts`), and
    // the approval registry is keyed on that id. Correlating the two ids must not quietly change
    // which id resolves the pause — the run is answered with `approvalId`, and it resumed here.
    const chunks = await runGated({ approve: true })

    const approval = chunks.find((c) => c.type === 'tool-approval-request')
    expect(typeof (approval as unknown as { approvalId: string }).approvalId).toBe('string')
    expect(chunks.some((c) => c.type === 'tool-output-available')).toBe(true)
  })

  it('test_the_ids_correlate_when_the_runtime_call_reaches_the_wire_first', async () => {
    // The other true ordering. Which producer wins is microtask scheduling, so a correlation that
    // only held in the measured order would be a coin flip in production.
    h.runtimeCallFirst = true

    const chunks = await runGated({ approve: true })

    const announced = idsOf(chunks, 'tool-input-available')
    expect(announced).toHaveLength(1)
    const approval = chunks.find((c) => c.type === 'tool-approval-request')
    expect((approval as unknown as { toolCallId: string }).toolCallId).toBe(announced[0])
    expect(idsOf(chunks, 'tool-output-available')).toEqual(announced)
  })

  it('test_a_denied_call_is_also_one_call_on_the_wire', async () => {
    // Denial takes the other branch of the SDK's dispatch and still reports the call under the
    // runtime id, so it doubled exactly like the approved path.
    const chunks = await runGated({ approve: false })

    const announced = idsOf(chunks, 'tool-input-available')
    expect(announced).toHaveLength(1)
    expect(resultIds(chunks)).toEqual(announced)
    // #388 — and the denial is reported as a failure, not as the tool's output: the SDK completes a
    // vetoed call with exit code 126, and a call a human refused never produced anything to show.
    const output = chunks.find((c) => c.type === 'tool-output-error')
    expect(String((output as unknown as { errorText: unknown }).errorText)).toContain(
      'denied by human approver',
    )
  })

  it('test_two_concurrent_calls_of_the_same_gated_tool_stay_two_calls', async () => {
    // The pairing key is the tool NAME, because it is the only field both producers carry. This is
    // the case that would punish a single-slot map: `mapWithConcurrency` dispatches both calls of a
    // round, so two approvals of one name are outstanding at once, and merging them would turn two
    // calls into one — the reported defect inverted.
    h.concurrentCalls = true

    const chunks = await runGated({ approve: true })

    const announced = idsOf(chunks, 'tool-input-available')
    expect(announced).toHaveLength(2)
    expect(new Set(announced).size).toBe(2)
    const byName = (a: string, b: string): number => a.localeCompare(b)
    expect(idsOf(chunks, 'tool-output-available').sort(byName)).toEqual([...announced].sort(byName))
  })

  it('test_an_ungated_run_is_unchanged', async () => {
    // The correlation is identity for a call no approval ever claims. Asserted through the served
    // path rather than by reading the branch, because "unchanged" is the claim most easily broken
    // by a state machine that now keys tool calls by name.
    const compiled = applyCapabilities([])
    const chunks: WireChunk[] = []
    for await (const chunk of streamAgentUIMessages(compiled, 'test-key', {
      message: 'hi',
      sessionId: `sess-${Math.random()}`,
    })) {
      chunks.push(chunk)
    }

    expect(chunks.some((c) => c.type === 'tool-approval-request')).toBe(false)
    expect(chunks.at(-1)?.type).toBe('finish')
  })
})

/** A span recorder that also records WHEN — the criterion under test is a duration. */
interface TimedSpan {
  name: string
  attrs: Record<string, unknown>
  status?: string
  startedAt: number
  endedAt?: number
}

function createTimedRecorder() {
  const spans: TimedSpan[] = []
  // Typed against the contract rather than inferred. An inferred mock drifts the
  // moment the interface gains a parameter — `startSpan` took a third argument
  // (the span's place in a trace) hours before this file was written, and an
  // `attrs` that was required rather than optional slipped past the package's own
  // test run and was caught by the pre-push typecheck. A mock that does not
  // declare what it stands in for cannot be told when it stops standing in for it.
  const adapter: ObservabilityAdapter = {
    name: 'timed-recorder',
    startSpan(name: string, attrs?: SpanAttributes) {
      const span: TimedSpan = { name, attrs: { ...attrs }, startedAt: performance.now() }
      spans.push(span)
      return {
        setAttribute(key: string, value: string | number | boolean) {
          span.attrs[key] = value
        },
        setStatus(status: 'ok' | 'error') {
          span.status = status
        },
        end() {
          span.endedAt = performance.now()
        },
      }
    },
    counter() {},
    histogram() {},
    log() {},
    flush: async () => {},
    shutdown: async () => {},
  }
  const duration = (name: string): number => {
    const span = spans.find((s) => s.name === name)
    if (span?.endedAt === undefined) throw new Error(`span ${name} never ended`)
    return span.endedAt - span.startedAt
  }
  return { adapter, spans, duration, byName: (n: string) => spans.filter((s) => s.name === n) }
}

describe('theokit#361 the HITL pause span measures the human, not the run', () => {
  beforeEach(() => {
    h.beforeDispatchMs = 0
    h.runtimeCallFirst = false
    h.concurrentCalls = false
  })

  it('test_the_pause_span_duration_is_the_human_wait_and_not_the_run', async () => {
    // The J9 criterion, as an executable statement. Graded against a real collector on 2026-08-20,
    // a scripted 120 ms decision produced a pause span of 120.999936 ms and a run span of
    // 120.999936 ms — the same number, because the pause was never closed by the resume and fell
    // through to the end-of-run sweep. Asserting only "the ids match" would not have caught that:
    // the numbers agreed while the correlation was broken.
    //
    // So the run is given time the human did NOT spend — 120 ms before the gated tool is dispatched
    // — and the decision then takes 120 ms of its own. A pause that measures the run cannot be
    // materially shorter than it; a pause that measures the human must be.
    const beforeDispatchMs = 120
    const humanDelayMs = 120
    h.beforeDispatchMs = beforeDispatchMs

    const { compiled, registry, hitl } = gatedAgent()
    const { adapter, byName, duration } = createTimedRecorder()
    const wire = streamAgentUIMessages(compiled, 'test-key', {
      message: 'deploy please',
      sessionId: `sess-${Math.random()}`,
      hitl,
    })
    for await (const chunk of observeAgentRun(wire, adapter, { agent: 'ops' })) {
      const observed = chunk as unknown as { type: string; approvalId?: string }
      if (observed.type === 'tool-approval-request' && observed.approvalId !== undefined) {
        const approvalId = observed.approvalId
        setTimeout(() => registry.resolve(approvalId, true), humanDelayMs)
      }
    }

    const pauses = byName('agent.hitl')
    expect(pauses).toHaveLength(1)
    expect(pauses[0].attrs.tool).toBe('ops_deploy')
    // Closed by the resume, and saying so: the attribute is what tells an operator the number means
    // anything at all.
    expect(pauses[0].attrs['hitl.resume_observed']).toBe(true)
    expect(pauses[0].status).toBe('ok')

    const pauseMs = duration('agent.hitl')
    const runMs = duration('agent.run')
    // A timer never fires early; the floor is the scripted delay minus scheduler granularity.
    expect(pauseMs).toBeGreaterThanOrEqual(humanDelayMs * 0.9)
    // And the run carries the 120 ms the human did not spend, so the two cannot be the same number.
    expect(runMs - pauseMs).toBeGreaterThanOrEqual(beforeDispatchMs * 0.7)
  })

  it('test_one_gated_call_produces_one_tool_span', async () => {
    // J9 criterion 2, which failed for a gated tool as an OVERCOUNT: one logical call yielded two
    // `agent.tool` spans, because each `tool-input-available` opened one.
    const { compiled, registry, hitl } = gatedAgent()
    const { adapter, byName } = createTimedRecorder()
    const wire = streamAgentUIMessages(compiled, 'test-key', {
      message: 'deploy please',
      sessionId: `sess-${Math.random()}`,
      hitl,
    })
    for await (const chunk of observeAgentRun(wire, adapter, { agent: 'ops' })) {
      const observed = chunk as unknown as { type: string; approvalId?: string }
      if (observed.type === 'tool-approval-request' && observed.approvalId !== undefined) {
        registry.resolve(observed.approvalId, true)
      }
    }

    const tools = byName('agent.tool')
    expect(tools).toHaveLength(1)
    expect(tools[0].attrs.tool).toBe('ops_deploy')
    expect(tools[0].status).toBe('ok')
  })
})
