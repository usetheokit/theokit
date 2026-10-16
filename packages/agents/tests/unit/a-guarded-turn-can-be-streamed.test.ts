/**
 * B-414 — a guarded turn can be streamed, and its guards run once.
 *
 * `@theokit/acp` reads a turn through `run.stream()` after `send()`. The turn `withGuardrails` built
 * had `wait` only, so a guarded agent served over ACP had nothing to stream. The fix (plan D1) gives
 * the guarded turn a `stream()` that yields ONE assistant message carrying the guarded text, after
 * the output guards, and shares one promise with `wait()` so the guards run once per turn.
 *
 * That promise is created by whichever of the two is consumed first, never by `send()`: a run that
 * fails, or an output guard that blocks, before anybody consumes the turn must not become an
 * `unhandledRejection`. The two delayed-consumption tests below pin that.
 */
import { afterEach, describe, expect, it } from 'vitest'

import { withGuardrails } from '../../src/bridge/handle-wrappers.js'
import type { SdkAgentHandle } from '../../src/bridge/sdk-adapter.js'
import { GuardrailViolationError } from '../../src/guardrails/index.js'
import type { Guardrail } from '../../src/guardrails/index.js'

interface TurnOutcome {
  result?: string
  status?: string
}

/** A fake handle whose turn resolves `outcome`, or rejects with `failure`, when `wait` is called. */
function fakeHandle(behaviour: { outcome?: TurnOutcome; failure?: Error }): SdkAgentHandle {
  return {
    agentId: 'fake-agent',
    dispose: () => Promise.resolve(),
    send: () =>
      Promise.resolve({
        // Created inside `wait`, so the fake holds no rejected promise before it is called.
        wait: () =>
          behaviour.failure === undefined
            ? Promise.resolve(behaviour.outcome ?? {})
            : Promise.reject(behaviour.failure),
      }),
  }
}

/** An output guard that replaces BANANA with [REDACTED] and counts its calls. */
function countingRedactor(): { guard: Guardrail; calls: () => number } {
  let calls = 0
  return {
    guard: {
      name: 'redact-banana',
      checkOutput: (text) => {
        calls += 1
        return { action: 'redact', text: text.replaceAll('BANANA', '[REDACTED]') }
      },
    },
    calls: () => calls,
  }
}

const BLOCKED_OUTPUT = { guardName: 'block-everything-out', phase: 'output' }

const blockingGuard: Guardrail = {
  name: 'block-everything-out',
  checkOutput: () => ({ action: 'block', reason: 'nothing leaves' }),
}

const FINISHED = { status: 'finished', result: 'the word is BANANA' }

async function collect(stream: (() => AsyncIterable<unknown>) | undefined): Promise<unknown[]> {
  expect(stream, 'the guarded turn has no stream(): ACP has nothing to read').toBeTypeOf('function')
  const messages: unknown[] = []
  for await (const message of (stream as () => AsyncIterable<unknown>)()) messages.push(message)
  return messages
}

function assistantMessage(text: string): unknown {
  return { type: 'assistant', message: { content: [{ type: 'text', text }] } }
}

/** Two event-loop turns: Node reports an unhandled rejection when the microtask queue drains. */
async function letTheEventLoopTurnTwice(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
}

const unhandled: unknown[] = []
const recordUnhandled = (reason: unknown): void => {
  unhandled.push(reason)
}

afterEach(() => {
  process.off('unhandledRejection', recordUnhandled)
  unhandled.length = 0
})

describe('a guarded turn can be streamed', () => {
  it('test_stream_then_wait_run_the_guard_once_and_carry_the_guarded_text', async () => {
    const redactor = countingRedactor()
    const handle = withGuardrails(fakeHandle({ outcome: FINISHED }), [redactor.guard])
    const turn = await handle.send('say it')

    const messages = await collect(turn.stream)
    const out = await turn.wait()

    expect(messages).toEqual([assistantMessage('the word is [REDACTED]')])
    expect(out.result).toBe('the word is [REDACTED]')
    expect(redactor.calls()).toBe(1)
  })

  it('test_stream_and_wait_started_together_share_one_guard_run', async () => {
    const redactor = countingRedactor()
    const handle = withGuardrails(fakeHandle({ outcome: FINISHED }), [redactor.guard])
    const turn = await handle.send('say it')

    const [messages, out] = await Promise.all([collect(turn.stream), turn.wait()])

    expect(messages).toEqual([assistantMessage('the word is [REDACTED]')])
    expect(out.result).toBe('the word is [REDACTED]')
    expect(redactor.calls(), 'stream and wait each ran the guards').toBe(1)
  })

  it('test_wait_alone_runs_the_guard_once', async () => {
    const redactor = countingRedactor()
    const handle = withGuardrails(fakeHandle({ outcome: FINISHED }), [redactor.guard])
    const turn = await handle.send('say it')

    expect((await turn.wait()).result).toBe('the word is [REDACTED]')
    expect(redactor.calls()).toBe(1)
  })

  it('test_a_rejected_wait_makes_stream_yield_nothing_and_wait_rethrow_the_held_error', async () => {
    const failure = new Error('the run failed')
    const handle = withGuardrails(fakeHandle({ failure }), [countingRedactor().guard])
    const turn = await handle.send('say it')

    expect(await collect(turn.stream)).toEqual([])
    await expect(turn.wait()).rejects.toBe(failure)
  })

  it('test_a_turn_with_no_result_yields_nothing_and_runs_no_guard', async () => {
    const redactor = countingRedactor()
    const handle = withGuardrails(fakeHandle({ outcome: { status: 'finished' } }), [redactor.guard])
    const turn = await handle.send('say it')

    expect(await collect(turn.stream)).toEqual([])
    expect((await turn.wait()).result).toBeUndefined()
    expect(redactor.calls()).toBe(0)
  })

  it('test_a_blocking_output_guard_makes_stream_yield_nothing_and_wait_reject', async () => {
    const handle = withGuardrails(fakeHandle({ outcome: FINISHED }), [blockingGuard])
    const turn = await handle.send('say it')

    expect(await collect(turn.stream)).toEqual([])
    const violation = turn.wait()
    await expect(violation).rejects.toBeInstanceOf(GuardrailViolationError)
    await expect(violation).rejects.toMatchObject(BLOCKED_OUTPUT)
  })

  it('test_a_rejected_run_consumed_late_raises_no_unhandled_rejection', async () => {
    process.on('unhandledRejection', recordUnhandled)
    const failure = new Error('the run failed before anyone asked')
    const handle = withGuardrails(fakeHandle({ failure }), [countingRedactor().guard])
    const turn = await handle.send('say it')

    await letTheEventLoopTurnTwice()

    expect(unhandled).toEqual([])
    expect(await collect(turn.stream)).toEqual([])
    await expect(turn.wait()).rejects.toBe(failure)
  })

  it('test_a_blocking_output_guard_consumed_late_raises_no_unhandled_rejection', async () => {
    process.on('unhandledRejection', recordUnhandled)
    const handle = withGuardrails(fakeHandle({ outcome: FINISHED }), [blockingGuard])
    const turn = await handle.send('say it')

    await letTheEventLoopTurnTwice()

    expect(unhandled).toEqual([])
    expect(await collect(turn.stream)).toEqual([])
    const violation = turn.wait()
    await expect(violation).rejects.toBeInstanceOf(GuardrailViolationError)
    await expect(violation).rejects.toMatchObject(BLOCKED_OUTPUT)
  })
})
