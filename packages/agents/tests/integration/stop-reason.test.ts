/**
 * theokit#379 — a run the SDK CUT reaches the caller as a cut run, not as an ordinary `done`.
 *
 * ## What this pins, and why a unit test would not have
 *
 * The sibling of #363, one layer out: #363 made the declared ceiling travel IN, this makes the
 * outcome travel BACK. The defect was never "a helper computes the wrong reason" — nothing computed
 * one. `realUsageDone` read three fields off a `RunResult` that reports more, and the `wait()` shape
 * the adapter types locally declared no field the reason could have been read from. A unit test of
 * `realUsageDone` against a hand-written fixture would have been green against that, because the
 * fixture and the code shared the assumption that a run object carries `{result, usage, cost}`.
 *
 * So these tests mock ONLY `@theokit/sdk` and assert on what crosses the served boundary. The real
 * `createSdkAgentStream`, `presentUIMessageStream` and `streamAgentUIMessages` run — the last being
 * what `mountAgent` calls — and the mocked `wait()` RETURNS the SDK's own flags, so the assertion is
 * that the information survives every layer between the SDK and the wire.
 *
 * ## The fixture is anchored to the published SDK, not to a guess
 *
 * `stoppedAtIterationLimit` and `stoppedByDoomLoop` are the two optional booleans declared on
 * `RunResult` in `@theokit/sdk@4.52.1`'s shipped `run-*.d.ts`. The doom-loop-wins precedence
 * asserted below is the SDK's own `classifyRound`, which tests `stoppedByDoomLoop` first.
 *
 * ## Why it matters for every agent, not only a capped one
 *
 * The SDK's ceiling has a DEFAULT of 8 (`IterationBudget`: `opts.maxIterations ?? 8`). An agent that
 * declares no ceiling still gets one, so every served run that needs a ninth tool-calling turn was
 * being truncated and reported as finished.
 */
import 'reflect-metadata'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CompiledAgentOptions } from '../../src/bridge/agent-compiler.js'

const h = vi.hoisted(() => ({
  /**
   * What the mocked SDK `Run.wait()` resolves to. Shaped as the SDK's `RunResult` subset this layer
   * reads; each test sets the truncation flags it is about.
   */
  waitResult: {} as Record<string, unknown>,
}))

vi.mock('@theokit/sdk', () => ({
  Tool: { create: (spec: unknown) => spec },
  Agent: {
    getOrCreate: vi.fn(async (id: string) => ({
      agentId: id,
      send: async () => ({
        events: async function* () {
          yield { kind: 'message', message: { type: 'status', status: 'FINISHED' } }
        },
        wait: async () => h.waitResult,
      }),
      dispose: async () => {},
    })),
  },
}))

const { createSdkAgentStream } = await import('../../src/bridge/sdk-adapter.js')
const { streamAgentUIMessages } = await import('../../src/bridge/agent-endpoint.js')
const { defineAgent, compileAgentDefinition } = await import('../../src/bridge/define-agent.js')

/** An agent that declares NO ceiling — the case the SDK's default of 8 silently caps. */
function uncappedAgent(): CompiledAgentOptions {
  return compileAgentDefinition(defineAgent({ model: 'm' }))
}

/** The framework-level terminal frame `createSdkAgentStream` ends on. */
async function terminalFrame(): Promise<Record<string, unknown>> {
  const stream = createSdkAgentStream(
    uncappedAgent(),
    [],
    'test-key',
  )('go', `sess-${Math.random()}`)
  let last: Record<string, unknown> | undefined
  for await (const event of stream) last = event as Record<string, unknown>
  if (last?.type !== 'done') throw new Error(`expected a terminal done, got ${String(last?.type)}`)
  return last
}

/** The `messageMetadata` riding the wire `finish` chunk — what a web client reconstructs. */
async function finishMetadata(): Promise<Record<string, unknown> | undefined> {
  const chunks: Record<string, unknown>[] = []
  for await (const chunk of streamAgentUIMessages(uncappedAgent(), 'test-key', {
    message: 'go',
    sessionId: `sess-${Math.random()}`,
  })) {
    chunks.push(chunk as unknown as Record<string, unknown>)
  }
  const finish = chunks.at(-1)
  expect(finish?.type).toBe('finish')
  return finish?.messageMetadata as Record<string, unknown> | undefined
}

describe('theokit#379 a truncated run says so on the terminal frame', () => {
  beforeEach(() => {
    h.waitResult = {}
  })

  it('test_iteration_limit_stop_reaches_the_done_event', async () => {
    // The SDK reports it; before this shipped, the adapter's `wait()` type had nowhere to read it
    // from and `realUsageDone` never looked.
    h.waitResult = { result: 'partial', stoppedAtIterationLimit: true }

    expect(await terminalFrame()).toMatchObject({ type: 'done', stopReason: 'step_limit' })
  })

  it('test_iteration_limit_stop_reaches_the_served_wire_metadata', async () => {
    // The whole point: `streamAgentUIMessages` is what `mountAgent` calls, and `messageMetadata` is
    // what a client reads off `UIMessage.metadata`. A reason that stops at the framework frame is a
    // reason the caller still cannot read.
    h.waitResult = { result: 'partial', stoppedAtIterationLimit: true }

    expect(await finishMetadata()).toMatchObject({ stopReason: 'step_limit' })
  })

  it('test_doom_loop_stop_reaches_the_served_wire_metadata_as_no_progress', async () => {
    // The sibling outcome: the model repeated identical tool calls and was stopped. Same silence,
    // and the OPPOSITE continuation decision — which is why the field is an enum, not `truncated`.
    h.waitResult = { result: 'stuck', stoppedByDoomLoop: true }

    expect(await finishMetadata()).toMatchObject({ stopReason: 'no_progress' })
  })

  it('test_doom_loop_wins_when_the_sdk_reports_both', async () => {
    // Precedence copied from the SDK's own `classifyRound`, which tests `stoppedByDoomLoop` first.
    // Disagreeing with it would make our reason and the SDK continuation driver's reason describe
    // the same run differently.
    h.waitResult = { result: 'stuck', stoppedAtIterationLimit: true, stoppedByDoomLoop: true }

    expect(await finishMetadata()).toMatchObject({ stopReason: 'no_progress' })
  })

  it('test_the_reason_travels_for_an_agent_that_declared_no_ceiling', async () => {
    // The severity argument, as a test. The SDK's `IterationBudget` defaults to 8, so this agent —
    // which never declared a ceiling — is exactly the common case that was truncating in silence.
    h.waitResult = { result: 'partial', stoppedAtIterationLimit: true }
    const compiled = uncappedAgent()

    expect('maxIterations' in compiled).toBe(false)
    expect(await finishMetadata()).toMatchObject({ stopReason: 'step_limit' })
  })
})

describe('theokit#379 a run that finishes on its own is untouched', () => {
  beforeEach(() => {
    h.waitResult = {}
  })

  it('test_clean_finish_omits_the_key_entirely_from_the_done_event', async () => {
    // ABSENT, not `undefined`. Absence is what keeps meaning "the agent finished", and a key holding
    // `undefined` would be a new field on every existing run.
    h.waitResult = { result: 'all done' }

    expect('stopReason' in (await terminalFrame())).toBe(false)
  })

  it('test_clean_finish_metadata_is_unchanged', async () => {
    // A consumer that has never heard of `stopReason` must receive what it received before. Asserted
    // with `toEqual` (exact), not `toMatchObject`, so a stray key fails this.
    h.waitResult = {
      result: 'all done',
      usage: { inputTokens: 3, outputTokens: 4 },
      cost: { amount: 0.5 },
    }

    const metadata = await finishMetadata()

    expect(metadata).toEqual({
      usage: {
        inputTokens: 3,
        outputTokens: 4,
        totalTokens: 7,
        reasoningTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
      durationMs: expect.any(Number) as unknown as number,
      cost: 0.5,
    })
  })

  it('test_an_sdk_that_reports_neither_flag_degrades_to_no_reason', async () => {
    // The optional-peer discipline: an SDK predating these fields resolves a `wait()` without them,
    // and this layer reads `undefined` rather than breaking.
    h.waitResult = { result: 'from an older sdk', usage: { inputTokens: 1, outputTokens: 1 } }

    const metadata = await finishMetadata()

    expect(metadata && 'stopReason' in metadata).toBe(false)
  })

  it('test_a_false_flag_is_not_a_stop_reason', async () => {
    // `false` is the SDK saying the run was NOT cut. Reading it as truthy-ish would flag every
    // clean run — the opposite defect, and the harder one to notice.
    h.waitResult = { result: 'ok', stoppedAtIterationLimit: false, stoppedByDoomLoop: false }

    expect('stopReason' in (await terminalFrame())).toBe(false)
  })
})
