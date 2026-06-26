/**
 * V4-P — the reflective loop retries a transient failure at a ROUND START (factory creation +
 * first event, before any event is yielded → no re-applied edit), reusing the SDK `withRetry`.
 * Opt-in via `config.retry`; absent ⇒ single attempt (backward-compatible). Closes the theocode
 * regression `test_runCodeAgent_retries_transient_error_on_continuation_round`.
 */
import 'reflect-metadata'
import { describe, expect, it } from 'vitest'

import { runReflectiveLoop, type RoundStreamFactory } from '../../src/loop/run-reflective-loop.js'
import { resolveLoopStrategy } from '../../src/loop/loop-strategy.js'
import { noopReflectionStrategy } from '../../src/loop/reflection-strategy.js'

const oneShot = resolveLoopStrategy('simple-chat', 1)
const noWait = { sleep: async () => {}, initialDelayMs: 0 }

/** A factory whose first `attempts` invocations throw; the next yields a terminal `done`. */
function flakyFactory(throwCount: number, counter: { calls: number }): RoundStreamFactory {
  return () => ({
    async *[Symbol.asyncIterator]() {
      counter.calls += 1
      if (counter.calls <= throwCount) throw new Error('transient boom')
      yield { type: 'done', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }
    },
  })
}

describe('V4-P loop transient retry', () => {
  it('test_retryable_round_start_is_retried_then_succeeds', async () => {
    const counter = { calls: 0 }
    const result = await runReflectiveLoop(flakyFactory(1, counter), 'task', 's', {
      loop: oneShot,
      reflection: noopReflectionStrategy,
      retry: { retries: 2, isRetryable: () => true, ...noWait },
    })
    expect(counter.calls).toBe(2) // first attempt threw, second succeeded
    expect(result.finishReason).toBe('stop') // the run completed, not aborted
  })

  it('test_non_retryable_error_propagates', async () => {
    const counter = { calls: 0 }
    await expect(
      runReflectiveLoop(flakyFactory(5, counter), 'task', 's', {
        loop: oneShot,
        reflection: noopReflectionStrategy,
        retry: { retries: 3, isRetryable: () => false, ...noWait },
      }),
    ).rejects.toThrow()
    expect(counter.calls).toBe(1) // not retryable → single attempt
  })

  it('test_exhausted_retries_propagate', async () => {
    const counter = { calls: 0 }
    await expect(
      runReflectiveLoop(flakyFactory(99, counter), 'task', 's', {
        loop: oneShot,
        reflection: noopReflectionStrategy,
        retry: { retries: 2, isRetryable: () => true, ...noWait },
      }),
    ).rejects.toThrow()
    expect(counter.calls).toBe(3) // 1 initial + 2 retries, all threw
  })

  it('test_no_retry_config_is_single_attempt', async () => {
    const counter = { calls: 0 }
    await expect(
      runReflectiveLoop(flakyFactory(1, counter), 'task', 's', {
        loop: oneShot,
        reflection: noopReflectionStrategy,
        // no `retry` → backward-compatible single attempt
      }),
    ).rejects.toThrow()
    expect(counter.calls).toBe(1)
  })
})
