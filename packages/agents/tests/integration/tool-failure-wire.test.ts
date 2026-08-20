/**
 * usetheokit/theokit#388 — a tool that FAILED reaches the caller as a failed tool.
 *
 * ## What this pins, and why the translator's own unit suite could not
 *
 * `event-translator.test.ts` was green throughout the defect, and correctly so: it drives each
 * translation site in isolation, with a hand-written `result` that is a bare string. The defect only
 * exists when BOTH of the SDK's reports of one completion travel the same timeline — the delta,
 * which carries the rendered output and structurally cannot carry an exit code, and the message,
 * which carries `{stdout, stderr, exitCode}`. `dedupeTools` dropped the second as a duplicate of the
 * first, so the only report that knew the call had failed never reached the wire, and the failure
 * text was published in the SUCCESS field.
 *
 * So these tests mock ONLY `@theokit/sdk` and assert on what crosses the served boundary. The real
 * `createSdkAgentStream`, `event-translator`, `sdk-timeline`, `presentUIMessageStream` and
 * `streamAgentUIMessages` run — the last being what `mountAgent` calls. The presenter branch that
 * emits `tool-output-error` already existed and already had a passing unit test; what was missing
 * was any path that reached it from a served run, which is exactly what a unit test cannot show.
 *
 * ## The fixture is the shipped SDK's own output, not a convenient shape
 *
 * Every event below was read out of `@theokit/sdk@4.52.1`'s installed bundle, not from its docs:
 *
 * - `dispatchSingleCall` pushes `buildToolUseRunning` (message, `status: 'running'`), then
 *   `runToolWithLifecycle` awaits the `tool-call-started` delta, awaits the `tool-call-completed`
 *   delta, and only then does `finalizeSpanAndPostHook` push `buildToolUseCompleted`. The message
 *   that carries the exit code is therefore ALWAYS the second report of the completion.
 * - `buildToolUseCompleted` hardcodes `status: 'completed'` and
 *   `result: {stdout, stderr, exitCode: result.exitCode ?? 0}`. There is no `status: 'error'` for a
 *   throwing tool anywhere in the bundle, which is why reading the lifecycle status could not work.
 * - the completion delta's `result` is `result.content ?? renderToolResult(result)`, and
 *   `renderToolResult` is ``result.stderr.length > 0 && exitCode !== 0 ? `${stdout}\n[stderr]\n${stderr}`.trim() : stdout.trim()``.
 * - `runHandlerTool` catches anything a custom handler throws and returns
 *   `{stdout: '', stderr: message, exitCode: 1}`. A retry that exhausts is not a distinct case at
 *   this layer: `Retry.create` lives inside the handler, so the SDK sees one call and one throw,
 *   and the wire the J6 benchmark measured for an exhausted retry is byte-identical to the one
 *   asserted here for a single throw.
 */
import 'reflect-metadata'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WireChunk } from '@theokit/presenter/wire'

/** The fake run's timeline — set per test, read inside the hoisted SDK mock. */
const h = vi.hoisted(() => ({ timeline: [] as unknown[] }))

vi.mock('@theokit/sdk', () => ({
  Tool: { create: (spec: unknown) => spec },
  Agent: {
    getOrCreate: vi.fn(async (id: string) => ({
      agentId: id,
      send: async () => ({
        events: async function* () {
          for (const ev of h.timeline) yield ev
        },
        wait: async () => ({ result: 'done', usage: { inputTokens: 1, outputTokens: 2 } }),
      }),
      dispose: async () => {},
    })),
  },
}))

const { streamAgentUIMessages } = await import('../../src/bridge/agent-endpoint.js')
const { defineAgent, compileAgentDefinition } = await import('../../src/bridge/define-agent.js')

const ARGS = { orderId: 'A-9999' }
const FAILURE = 'order service returned 404 for "A-9999"'

/** `buildToolUseRunning` verbatim. */
function runningMessage(callId: string, name: string): Record<string, unknown> {
  return {
    kind: 'message',
    message: {
      type: 'tool_call',
      agent_id: 'a',
      run_id: 'r',
      call_id: callId,
      name,
      status: 'running',
      args: ARGS,
    },
  }
}

/** `buildToolUseCompleted` verbatim — the only report that carries the exit code. */
function completedMessage(
  callId: string,
  name: string,
  result: { stdout: string; stderr: string; exitCode: number },
): Record<string, unknown> {
  return {
    kind: 'message',
    message: {
      type: 'tool_call',
      agent_id: 'a',
      run_id: 'r',
      call_id: callId,
      name,
      status: 'completed',
      args: ARGS,
      result,
    },
  }
}

function startedDelta(callId: string, name: string): Record<string, unknown> {
  return {
    kind: 'delta',
    update: {
      type: 'tool-call-started',
      callId,
      toolCall: { callId, name, args: ARGS },
      modelCallId: callId,
    },
  }
}

/** `renderToolResult` verbatim — what the completion delta carries in `result`. */
function renderToolResult(result: { stdout: string; stderr: string; exitCode: number }): string {
  if (result.stderr.length > 0 && result.exitCode !== 0) {
    return `${result.stdout}\n[stderr]\n${result.stderr}`.trim()
  }
  return result.stdout.trim()
}

function completedDelta(
  callId: string,
  name: string,
  result: { stdout: string; stderr: string; exitCode: number },
): Record<string, unknown> {
  return {
    kind: 'delta',
    update: {
      type: 'tool-call-completed',
      callId,
      toolCall: { callId, name, args: ARGS, result: renderToolResult(result) },
      modelCallId: callId,
    },
  }
}

/** One full tool call, in the order `dispatchSingleCall` produces it. */
function toolCall(
  callId: string,
  name: string,
  result: { stdout: string; stderr: string; exitCode: number },
): Record<string, unknown>[] {
  return [
    runningMessage(callId, name),
    startedDelta(callId, name),
    completedDelta(callId, name, result),
    completedMessage(callId, name, result),
  ]
}

/** The model's closing turn: the delta, then the message the SDK marks as already streamed. */
function assistantTurn(text: string): Record<string, unknown>[] {
  return [
    { kind: 'delta', update: { type: 'text-delta', text } },
    {
      kind: 'message',
      message: {
        type: 'assistant',
        agent_id: 'a',
        run_id: 'r',
        message: { role: 'assistant', content: [{ type: 'text', text }] },
      },
      textAlreadyStreamed: true,
    },
  ]
}

/** Drive the served path — what `mountAgent` calls — and collect the wire. */
async function wire(): Promise<WireChunk[]> {
  const compiled = compileAgentDefinition(defineAgent({ model: 'm' }))
  const chunks: WireChunk[] = []
  for await (const chunk of streamAgentUIMessages(compiled, 'test-key', {
    message: 'look up order A-9999',
    sessionId: `sess-${Math.random()}`,
  })) {
    chunks.push(chunk)
  }
  return chunks
}

/** The tool chunks only — the terminal frame carries a random text id and a wall-clock duration. */
function toolChunks(chunks: WireChunk[]): WireChunk[] {
  return chunks.filter((c) => c.type.startsWith('tool-'))
}

describe('theokit#388 a failed tool reaches the wire as a failed tool', () => {
  beforeEach(() => {
    h.timeline = []
  })

  it('test_a_handler_that_threw_is_reported_as_an_error_not_as_output', async () => {
    // The reported defect, measured on the J6 benchmark: the framework emitted
    // `tool-output-available` whose `output` was the failure text, and the run then ended on an
    // ordinary `done`. Nothing on the wire distinguished it from a tool that answered.
    h.timeline = [
      ...toolCall('call-6ad5', 'order_lookup', { stdout: '', stderr: FAILURE, exitCode: 1 }),
      ...assistantTurn('The lookup is done.'),
    ]

    expect(toolChunks(await wire())).toEqual([
      {
        type: 'tool-input-available',
        toolCallId: 'call-6ad5',
        toolName: 'order_lookup',
        input: ARGS,
        dynamic: true,
      },
      {
        type: 'tool-output-error',
        toolCallId: 'call-6ad5',
        errorText: `[stderr]\n${FAILURE}`,
      },
    ])
  })

  it('test_the_failure_is_reported_once_and_before_the_text_that_follows_it', async () => {
    // Holding the first report to let the second inform it must not cost the wire its ORDER, and
    // must not put the call on the wire twice — that is theokit#361, closed the same day.
    h.timeline = [
      ...toolCall('call-6ad5', 'order_lookup', { stdout: '', stderr: FAILURE, exitCode: 1 }),
      ...assistantTurn('The lookup is done.'),
    ]

    const chunks = await wire()
    const types = chunks.map((c) => c.type)
    expect(types.filter((t) => t.startsWith('tool-output-'))).toEqual(['tool-output-error'])
    expect(types.indexOf('tool-output-error')).toBeLessThan(types.indexOf('text-start'))
  })

  it('test_a_tool_that_succeeded_is_byte_identical_to_before', async () => {
    // The success path is the thing this must not buy the fix with. A run that worked emits exactly
    // `tool-output-available`, with the delta's rendered output — NOT the message's
    // `{stdout, stderr, exitCode}` object, which serializes to a JSON blob no consumer renders.
    h.timeline = [
      ...toolCall('call-6ad5', 'order_lookup', {
        stdout: 'SHIP-4471',
        stderr: '',
        exitCode: 0,
      }),
      ...assistantTurn('The reference is SHIP-4471.'),
    ]

    expect(toolChunks(await wire())).toEqual([
      {
        type: 'tool-input-available',
        toolCallId: 'call-6ad5',
        toolName: 'order_lookup',
        input: ARGS,
        dynamic: true,
      },
      { type: 'tool-output-available', toolCallId: 'call-6ad5', output: 'SHIP-4471' },
    ])
  })

  it('test_a_result_that_ends_the_run_still_reaches_the_wire', async () => {
    // A held result is released by the next timeline event, and a run whose last act is the tool
    // call has none. Without the end-of-timeline flush this trades the reported defect for a hole,
    // which is the worse of the two.
    h.timeline = toolCall('call-6ad5', 'order_lookup', {
      stdout: '',
      stderr: FAILURE,
      exitCode: 1,
    })

    expect(toolChunks(await wire())).toEqual([
      {
        type: 'tool-input-available',
        toolCallId: 'call-6ad5',
        toolName: 'order_lookup',
        input: ARGS,
        dynamic: true,
      },
      { type: 'tool-output-error', toolCallId: 'call-6ad5', errorText: `[stderr]\n${FAILURE}` },
    ])
  })

  it('test_a_completion_reported_only_by_the_delta_is_still_reported', async () => {
    // The delta is the only report on this timeline, so nothing can contribute an exit code. The
    // honest answer is the one the payload supports: the call is reported, and not called a failure
    // on the strength of a `[stderr]` prefix in a string. Matching on error TEXT is the heuristic
    // this ecosystem already paid for once (M93 read `ECONNREFUSED …:443` as a 4xx).
    h.timeline = [
      runningMessage('call-6ad5', 'order_lookup'),
      startedDelta('call-6ad5', 'order_lookup'),
      completedDelta('call-6ad5', 'order_lookup', { stdout: 'SHIP-4471', stderr: '', exitCode: 0 }),
      ...assistantTurn('The reference is SHIP-4471.'),
    ]

    expect(toolChunks(await wire())).toEqual([
      {
        type: 'tool-input-available',
        toolCallId: 'call-6ad5',
        toolName: 'order_lookup',
        input: ARGS,
        dynamic: true,
      },
      { type: 'tool-output-available', toolCallId: 'call-6ad5', output: 'SHIP-4471' },
    ])
  })

  it('test_a_completion_reported_only_by_the_message_carries_its_exit_code', async () => {
    // A vetoed call takes the SDK's other dispatch branch: `vetoFromPluginPreHook` pushes the
    // completed MESSAGE with exit code 126 and no delta is ever emitted, because
    // `runToolWithLifecycle` is not reached. This is the one report, and it knows.
    h.timeline = [
      runningMessage('call-6ad5', 'order_lookup'),
      completedMessage('call-6ad5', 'order_lookup', {
        stdout: '',
        stderr: 'blocked by hook',
        exitCode: 126,
      }),
      ...assistantTurn('That call was blocked.'),
    ]

    const [, output] = toolChunks(await wire())
    expect(output?.type).toBe('tool-output-error')
    expect((output as unknown as { errorText: string }).errorText).toContain('blocked by hook')
  })

  it('test_a_concurrent_success_does_not_release_a_failure_before_its_exit_code_lands', async () => {
    // `mapWithConcurrency` dispatches up to four calls of a round at once, so another call's
    // lifecycle events can land between one call's two reports. Releasing a held result on any next
    // event would spend the hold on the neighbour and publish the failure as a success — the
    // reported defect, reachable again through the door the fix opened.
    const failing = { stdout: '', stderr: FAILURE, exitCode: 1 }
    const working = { stdout: 'SHIP-4471', stderr: '', exitCode: 0 }
    h.timeline = [
      runningMessage('call-a', 'order_lookup'),
      runningMessage('call-b', 'stock_lookup'),
      startedDelta('call-a', 'order_lookup'),
      startedDelta('call-b', 'stock_lookup'),
      completedDelta('call-a', 'order_lookup', failing),
      // The neighbour reports its whole completion between call-a's two reports.
      completedDelta('call-b', 'stock_lookup', working),
      completedMessage('call-b', 'stock_lookup', working),
      completedMessage('call-a', 'order_lookup', failing),
      ...assistantTurn('Both lookups are done.'),
    ]

    const outputs = toolChunks(await wire()).filter((c) => c.type.startsWith('tool-output-'))
    expect(outputs).toEqual([
      { type: 'tool-output-error', toolCallId: 'call-a', errorText: `[stderr]\n${FAILURE}` },
      { type: 'tool-output-available', toolCallId: 'call-b', output: 'SHIP-4471' },
    ])
  })

  it('test_the_exit_code_wins_regardless_of_which_report_arrives_first', async () => {
    // Which of the two reports reaches the timeline first is the SDK's business and has changed
    // before (theokit#140 removed a whole merge layer built on the previous answer). A fix that only
    // held in the measured order would be relying on an ordering nobody promised, so the reversed
    // one is driven too.
    const failing = { stdout: '', stderr: FAILURE, exitCode: 1 }
    h.timeline = [
      runningMessage('call-6ad5', 'order_lookup'),
      startedDelta('call-6ad5', 'order_lookup'),
      completedMessage('call-6ad5', 'order_lookup', failing),
      completedDelta('call-6ad5', 'order_lookup', failing),
      ...assistantTurn('The lookup is done.'),
    ]

    const outputs = toolChunks(await wire()).filter((c) => c.type.startsWith('tool-output-'))
    expect(outputs).toHaveLength(1)
    expect(outputs[0]?.type).toBe('tool-output-error')
  })
})
