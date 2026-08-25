/**
 * theokit#475 — a tool cannot ask how much context the run has left.
 *
 * ## The defect
 *
 * Codex exposes `get_context_remaining` so a model can pace a long task. Building the same tool on
 * this package was impossible without lying: the tool handler's `ctx` is
 * `{signal, context, messages, threadId}`, no hook context carries usage, the `BudgetTracker` that
 * does carry real provider counts is an `Agent.create` option no handler holds, and the figure a
 * surface displays is read outside this package entirely. What was left was `~4 chars per token`
 * over `ctx.messages` — an estimate wearing a measurement's clothes.
 *
 * ## What these tests pin
 *
 * That the number a tool reads came from the PROVIDER, that it is live rather than frozen at wrap
 * time, that "not known yet" survives as `undefined` instead of collapsing into `0`, and that a run
 * which did not opt in is untouched — no `ctx.usage`, and no `budgetTracker` the SDK was not already
 * given.
 *
 * The fake SDK below drives the seam the way the real one does: it calls `budgetTracker.track()`
 * with the provider's counts after each "completion" and invokes the tool handler in between
 * (`chunk-KELIQH7K.js:6319-6347` — `runIteration` tracks usage immediately after `streamLlmTurn` and
 * before that iteration's tool dispatch). It invokes the handler with NO ctx of its own, so a green
 * test proves THIS layer injects the field rather than the SDK forwarding it.
 */
import type { BudgetTracker, CustomTool } from '@theokit/sdk'
import { describe, expect, it, vi, beforeEach } from 'vitest'

import type { RunUsageSnapshot } from '../../src/usage/run-usage.js'

interface Completion {
  inputTokens: number
  outputTokens: number
}

const h = vi.hoisted(() => ({
  /** Provider completions the fake loop reports BEFORE it calls the tool. */
  before: [] as Completion[],
  /** Provider completions the fake loop reports AFTER the first tool call, before a second one. */
  after: [] as Completion[],
  /** What `readRunUsage(ctx)` answered on each tool invocation — the oracle. */
  readings: [] as (RunUsageSnapshot | undefined)[],
  /** The options the SDK's `Agent.create` actually received. */
  createOptions: {} as Record<string, unknown>,
}))

vi.mock('@theokit/sdk', () => ({
  Tool: { create: (spec: unknown) => spec },
  Agent: {
    getOrCreate: (_id: string, opts: Record<string, unknown>) => {
      h.createOptions = opts
      const tools = (opts.tools ?? []) as { handler: (i: unknown) => unknown }[]
      const tracker = opts.budgetTracker as BudgetTracker | undefined
      const report = (c: Completion): void => {
        // The SDK guards both branches on `> 0`, so a bucket the provider did not report is never
        // tracked. Mirrored here, because that guard is what makes "no report yet" observable.
        if (c.inputTokens > 0)
          tracker?.track({ tokens: c.inputTokens, model: 'test/model', type: 'input' })
        if (c.outputTokens > 0)
          tracker?.track({ tokens: c.outputTokens, model: 'test/model', type: 'output' })
      }
      return Promise.resolve({
        send: async () => {
          for (const c of h.before) report(c)
          if (tools[0]) await tools[0].handler({})
          for (const c of h.after) report(c)
          if (tools[0]) await tools[0].handler({})
          return {
            events: async function* () {
              yield { kind: 'message', message: { type: 'status', status: 'FINISHED' } }
            },
            wait: () => Promise.resolve({ result: 'ok' }),
          }
        },
        dispose: () => Promise.resolve(),
      })
    },
  },
}))

const { createSdkAgentStream } = await import('../../src/bridge/sdk-adapter.js')
const { streamAgentTurnInProcess } = await import('../../src/in-process-turn.js')
const { readRunUsage } = await import('../../src/usage/run-usage.js')

/** A tool that records what `readRunUsage` answers when it runs — nothing else. */
function meteringTool(): CustomTool {
  return {
    name: 'get_context_remaining',
    description: 'records the run usage it can see',
    inputSchema: {},
    handler: (_input, ctx) => {
      h.readings.push(readRunUsage(ctx))
      return 'ok'
    },
  }
}

const TOOLS = [meteringTool()]
const COMPILED = {
  name: 'echo',
  instructions: 'echo',
  model: 'test/model',
  tools: TOOLS,
} as never
/**
 * `CompiledTool` and `CustomTool` differ in handler variance (`input: unknown` vs
 * `Record<string, unknown>`), and the adapter takes the former. The cast is the same one every
 * adapter test in this directory makes; what it stands in for is `compileAgentDefinition`, which
 * this test deliberately skips so the subject stays the tool ctx and not the compiler.
 */
const COMPILED_TOOLS = TOOLS as never

async function drain(stream: AsyncIterable<unknown>): Promise<void> {
  for await (const _ of stream) {
    // the assertions are on what the tool read, not on the events
  }
}

describe('theokit#475 — the run usage reaches a tool handler', () => {
  beforeEach(() => {
    h.before = []
    h.after = []
    h.readings = []
    h.createOptions = {}
  })

  it('test_a_tool_reads_the_real_provider_reported_tokens', async () => {
    // Arrange: the provider reported 1200 prompt + 340 completion tokens before the tool ran.
    h.before = [{ inputTokens: 1200, outputTokens: 340 }]

    // Act
    await drain(
      createSdkAgentStream(COMPILED, COMPILED_TOOLS, 'key', {
        exposeUsageToTools: true,
      })('hi', 's1'),
    )

    // Assert — the exact counts the provider stated, not a projection of anything.
    expect(h.readings[0], 'the tool could not see the run it is part of').toEqual({
      inputTokens: 1200,
      outputTokens: 340,
      totalTokens: 1540,
    })
  })

  it('test_the_reading_is_live_and_not_frozen_when_the_tool_was_wrapped', async () => {
    // Anti-vacuity for the test above: a snapshot taken at wrap time would report the same figure
    // on both calls and still pass it. The tool is invoked twice, with a completion in between.
    h.before = [{ inputTokens: 100, outputTokens: 10 }]
    h.after = [{ inputTokens: 200, outputTokens: 30 }]

    await drain(
      createSdkAgentStream(COMPILED, COMPILED_TOOLS, 'key', {
        exposeUsageToTools: true,
      })('hi', 's1'),
    )

    expect(h.readings.map((r) => r?.totalTokens)).toEqual([110, 340])
  })

  it('test_not_yet_known_is_distinguishable_from_zero', async () => {
    // The requirement stated as a test: a tool that runs before any completion has been reported
    // must be told "unknown", not "zero". Only one of those is ever true, and a model handed `0`
    // would reason from a number nobody measured.
    h.before = []
    h.after = [{ inputTokens: 500, outputTokens: 60 }]

    await drain(
      createSdkAgentStream(COMPILED, COMPILED_TOOLS, 'key', {
        exposeUsageToTools: true,
      })('hi', 's1'),
    )

    expect(
      h.readings[0],
      'a run with nothing reported yet handed the tool a token total',
    ).toBeUndefined()
    // And the SAME run answers with a real figure once the provider has spoken — so `undefined`
    // above is the state of the run, not the seam being broken.
    expect(h.readings[1]?.totalTokens).toBe(560)
  })

  it('test_a_declared_context_window_travels_with_the_usage', async () => {
    // `remaining` needs both halves. The window comes from `ModelSelection.contextWindow`, the same
    // input the SDK's own resolver treats as authoritative.
    h.before = [{ inputTokens: 1000, outputTokens: 500 }]

    await drain(
      createSdkAgentStream(COMPILED, COMPILED_TOOLS, 'key', {
        model: { id: 'test/model', contextWindow: 200_000 },
        exposeUsageToTools: true,
      })('hi', 's1'),
    )

    expect(h.readings[0]).toEqual({
      inputTokens: 1000,
      outputTokens: 500,
      totalTokens: 1500,
      contextWindowTokens: 200_000,
      remainingTokens: 198_500,
    })
  })

  it('test_a_bare_model_id_reports_usage_without_inventing_a_window', async () => {
    // Counterproof: the window is absent rather than guessed from the model catalog, which answers
    // unknown models with conservative defaults and no way to tell a miss from a hit.
    h.before = [{ inputTokens: 10, outputTokens: 5 }]

    await drain(
      createSdkAgentStream(COMPILED, COMPILED_TOOLS, 'key', {
        exposeUsageToTools: true,
      })('hi', 's1'),
    )

    expect(h.readings[0]?.contextWindowTokens).toBeUndefined()
    expect(h.readings[0]?.remainingTokens).toBeUndefined()
  })

  it('test_without_the_opt_in_nothing_changes', async () => {
    // Back-compat floor, both halves: the handler ctx carries no `usage`, and the SDK receives no
    // `budgetTracker` it was not already given.
    h.before = [{ inputTokens: 1200, outputTokens: 340 }]

    await drain(createSdkAgentStream(COMPILED, COMPILED_TOOLS, 'key', {})('hi', 's1'))

    expect(h.readings).toEqual([undefined, undefined])
    expect(Object.keys(h.createOptions)).not.toContain('budgetTracker')
  })

  it('test_a_callers_own_budget_tracker_still_receives_every_event', async () => {
    // `Agent.create` takes one tracker, so the meter WRAPS the caller's. A seam that replaced it
    // would silently disarm a spend gate — an observability feature paid for with a spend incident.
    const seen: { tokens: number; type: string }[] = []
    const delegate: BudgetTracker = {
      track: (e) => seen.push({ tokens: e.tokens, type: e.type }),
      check: () => ({ allowed: true }),
      getTotal: () => ({ tokens: -1 }),
    }
    h.before = [{ inputTokens: 90, outputTokens: 9 }]

    await drain(
      createSdkAgentStream(COMPILED, COMPILED_TOOLS, 'key', {
        exposeUsageToTools: true,
        budgetTracker: delegate,
      })('hi', 's1'),
    )

    expect(seen, "the caller's tracker stopped seeing the run").toEqual([
      { tokens: 90, type: 'input' },
      { tokens: 9, type: 'output' },
    ])
    // The tracker the SDK holds is the wrapper, and its totals still come from the delegate.
    expect((h.createOptions.budgetTracker as BudgetTracker).getTotal()).toEqual({ tokens: -1 })
    expect(h.readings[0]?.totalTokens).toBe(99)
  })

  it('test_the_seam_reaches_a_tool_from_the_PUBLIC_in_process_entry_point', async () => {
    // The adapter is internal. What an embedded surface holds is `streamAgentTurnInProcess`, and a
    // seam wired only on the adapter leaves the reported problem exactly where it was.
    h.before = [{ inputTokens: 77, outputTokens: 3 }]
    const module_ = {
      default: { tools: [meteringTool()], agents: {}, model: 'test/model' },
    }

    await drain(
      streamAgentTurnInProcess(module_, 'key', {
        message: 'hi',
        exposeUsageToTools: true,
      }) as unknown as AsyncIterable<unknown>,
    )

    expect(h.readings[0], 'the in-process entry accepts the opt-in but never forwards it').toEqual({
      inputTokens: 77,
      outputTokens: 3,
      totalTokens: 80,
    })
  })
})
