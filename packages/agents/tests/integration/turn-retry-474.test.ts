/**
 * theokit#474 — a transient provider failure ends the in-process turn.
 *
 * ## The defect
 *
 * `AgentRunnerRunOptions.retry` has existed since V4-P, so the package reads as if per-turn retry
 * were available. It is not available HERE: it belongs to the reflective loop, and an embedded
 * surface — a TUI, a CLI — runs `streamAgentTurnInProcess`, one SDK turn at a time. A 429 on the
 * first LLM call therefore ended the turn, and the person at the keyboard retyped the prompt.
 *
 * ## Why the fix is not a forwarded field
 *
 * `streamAgentUIMessages` had no `retry` parameter, and — measured in the shipped
 * `@theokit/sdk@4.52.1` — the SDK never rejects on a provider failure: `agent.send()` resolves
 * before the model is called, and the loop's failure is caught and reported as the run's TERMINAL
 * `status: "ERROR"` event. A `Retry` wrapper around the stream's creation would have compiled,
 * shipped, and never fired. These tests are written to fail against that version of the fix: the
 * fake SDK below reports its failure exactly the way the real one does, as an event.
 *
 * ## What the oracle is
 *
 * `attempts` — how many times the fake SDK was actually asked to run the turn. A test that only
 * checked the option was accepted, or that it appeared on some options object, would pass against a
 * seam that retries nothing. Every assertion here is about how many turns really happened, what the
 * consumer saw, and whether the failed attempt was released.
 */
import { AuthenticationError, RateLimitError } from '@theokit/sdk/errors'
import { describe, expect, it, vi, beforeEach } from 'vitest'

interface TimelineEvent {
  kind: 'message' | 'delta'
  message?: Record<string, unknown>
  update?: unknown
}

/** One scripted turn: what the run's timeline yields, and what `wait()` then reports. */
interface ScriptedTurn {
  events: TimelineEvent[]
  wait: Record<string, unknown>
}

const h = vi.hoisted(() => ({
  /** Scripted turns, consumed one per attempt; the last one repeats once exhausted. */
  turns: [] as ScriptedTurn[],
  /** How many times the SDK was asked to run the turn — the oracle. */
  attempts: 0,
  /** How many times the adapter disposed an agent. */
  disposals: 0,
}))

vi.mock('@theokit/sdk', () => ({
  Tool: { create: (spec: unknown) => spec },
  Agent: {
    getOrCreate: () =>
      Promise.resolve({
        send: () => {
          const turn = h.turns[Math.min(h.attempts, h.turns.length - 1)]!
          h.attempts += 1
          return Promise.resolve({
            events: async function* () {
              for (const e of turn.events) yield e
            },
            wait: () => Promise.resolve(turn.wait),
          })
        },
        dispose: () => {
          h.disposals += 1
          return Promise.resolve()
        },
      }),
  },
}))

const { createSdkAgentStream } = await import('../../src/bridge/sdk-adapter.js')
const { streamAgentTurnInProcess } = await import('../../src/in-process-turn.js')

const COMPILED = { name: 'echo', instructions: 'echo', model: 'test/model', tools: [] } as never
/** The module shape `compileAgentModule` accepts without going through definition compilation. */
const MODULE = { default: { tools: [], agents: { probe: { instructions: 'probe' } } } }

/** A run that failed with `cause`, reported the way the SDK reports it: as a terminal event. */
function failedTurn(message: string, cause: unknown): ScriptedTurn {
  return {
    events: [{ kind: 'message', message: { type: 'status', status: 'ERROR', message } }],
    wait: { error: { message, cause } },
  }
}

/** A run that answered. */
function okTurn(text: string): ScriptedTurn {
  return {
    events: [
      {
        kind: 'message',
        message: { type: 'assistant', message: { content: [{ type: 'text', text }] } },
      },
      { kind: 'message', message: { type: 'status', status: 'FINISHED' } },
    ],
    wait: { result: text, usage: { inputTokens: 7, outputTokens: 3 } },
  }
}

/**
 * Deterministic retry policy: no real timers, no jitter. `sleep`/`rng` are injection points the SDK
 * declares for exactly this, so the test measures the retry DECISION and not a stopwatch.
 */
const FAST_RETRY = {
  retries: 2,
  sleep: (): Promise<void> => Promise.resolve(),
  rng: (): number => 0,
}

async function collect(
  stream: AsyncIterable<{ type: string; [k: string]: unknown }>,
): Promise<{ type: string; [k: string]: unknown }[]> {
  const out: { type: string; [k: string]: unknown }[] = []
  for await (const e of stream) out.push(e)
  return out
}

describe('theokit#474 — a turn that failed before producing anything is retried', () => {
  beforeEach(() => {
    h.turns = []
    h.attempts = 0
    h.disposals = 0
  })

  it('test_transient_failure_before_any_output_is_retried_and_the_turn_survives', async () => {
    // Arrange: the first turn dies on a rate limit, the second answers.
    h.turns = [failedTurn('429 slow down', new RateLimitError('429 slow down')), okTurn('hello')]

    // Act
    const events = await collect(
      createSdkAgentStream(COMPILED, [], 'key', { retry: FAST_RETRY })('hi', 's1'),
    )

    // Assert
    expect(h.attempts, 'the turn was never retried — the option did not reach the runner').toBe(2)
    expect(
      events.filter((e) => e.type === 'error'),
      'the recovered failure still reached the consumer as an error frame',
    ).toEqual([])
    expect(
      events.map((e) => e.type),
      'the surviving attempt did not stream its answer',
    ).toEqual(['text_delta', 'done'])
    expect(
      h.disposals,
      'the failed attempt was not released — its agent stays in the SDK registry, and the retry ' +
        'would reuse the very agent whose turn just failed',
    ).toBe(2)
  })

  it('test_a_failure_the_sdk_calls_permanent_is_not_retried', async () => {
    // Counterproof for the test above: retrying is decided by the SDK's own error class, not by
    // "something went wrong". An auth failure retried three times is three fast failures and the
    // same message.
    h.turns = [failedTurn('bad key', new AuthenticationError('bad key'))]

    const events = await collect(
      createSdkAgentStream(COMPILED, [], 'key', { retry: FAST_RETRY })('hi', 's1'),
    )

    expect(h.attempts, 'a permanent failure was retried').toBe(1)
    expect(events.filter((e) => e.type === 'error')).toHaveLength(1)
    expect(events.find((e) => e.type === 'error')?.message).toContain('bad key')
  })

  it('test_a_failure_AFTER_output_is_never_retried', async () => {
    // The invariant that makes retrying safe: the window closes on the first event. By the time any
    // event is out, a tool may have run — re-running the turn could re-apply an edit.
    h.turns = [
      {
        events: [
          {
            kind: 'message',
            message: { type: 'assistant', message: { content: [{ type: 'text', text: 'part' }] } },
          },
          {
            kind: 'message',
            message: { type: 'status', status: 'ERROR', message: '429 mid-turn' },
          },
        ],
        wait: { error: { message: '429 mid-turn', cause: new RateLimitError('429 mid-turn') } },
      },
      okTurn('should never be reached'),
    ]

    const events = await collect(
      createSdkAgentStream(COMPILED, [], 'key', { retry: FAST_RETRY })('hi', 's1'),
    )

    expect(h.attempts, 'a turn that had already produced output was re-run').toBe(1)
    expect(events.map((e) => e.type)).toEqual(['text_delta', 'error'])
  })

  it('test_without_the_option_a_transient_failure_still_ends_the_turn', async () => {
    // Back-compat floor, and the counterproof that the retry is OPT-IN: the same transient that the
    // first test recovers must end the turn when nothing was declared.
    h.turns = [failedTurn('429 slow down', new RateLimitError('429 slow down')), okTurn('hello')]

    const events = await collect(createSdkAgentStream(COMPILED, [], 'key', {})('hi', 's1'))

    expect(h.attempts, 'the turn retried without anyone asking it to').toBe(1)
    expect(events.map((e) => e.type)).toEqual(['error'])
  })

  it('test_the_option_reaches_the_runner_from_the_PUBLIC_in_process_entry_point', async () => {
    // `createSdkAgentStream` is internal. What the consumer holds is `streamAgentTurnInProcess`, and
    // a seam wired only on the adapter would satisfy every test above while leaving the reported
    // problem exactly where it was — the shape theokit#189 already produced once, a field that
    // exists at both ends of a hop and is dropped in the middle.
    h.turns = [failedTurn('429 slow down', new RateLimitError('429 slow down')), okTurn('hello')]

    const chunks = await collect(
      streamAgentTurnInProcess(MODULE, 'key', {
        message: 'hi',
        retry: FAST_RETRY,
      }) as unknown as AsyncIterable<{ type: string }>,
    )

    expect(h.attempts, 'the in-process entry point accepts `retry` but never forwards it').toBe(2)
    expect(
      chunks.some((c) => c.type === 'error'),
      'the recovered failure still reached the wire',
    ).toBe(false)
  })

  it('test_the_in_process_entry_point_without_retry_makes_a_single_attempt', async () => {
    h.turns = [failedTurn('429 slow down', new RateLimitError('429 slow down')), okTurn('hello')]

    await collect(
      streamAgentTurnInProcess(MODULE, 'key', { message: 'hi' }) as unknown as AsyncIterable<{
        type: string
      }>,
    )

    expect(h.attempts).toBe(1)
  })
})
