/**
 * B-457 — a guard DEFECT is rethrown from a guarded turn's `stream()`, not shown as an outcome.
 *
 * `MalformedGuardrailResultError` (a guard returning `redact` with no `text`) is a guard written
 * wrong, not a guard refusing. The package CHANGELOG says a guard that blocks ends the stream with
 * an `ERROR` status and "any other error is rethrown from `stream()`" (loop-code-review LCR0602).
 */
import { describe, expect, it } from 'vitest'

import { withGuardrails } from '../../src/bridge/handle-wrappers.js'
import type { SdkAgentHandle } from '../../src/bridge/sdk-adapter.js'
import { MalformedGuardrailResultError } from '../../src/guardrails/index.js'
import type { Guardrail } from '../../src/guardrails/index.js'

function finishedHandle(result: string): SdkAgentHandle {
  return {
    agentId: 'fake-agent',
    dispose: () => Promise.resolve(),
    send: () => Promise.resolve({ wait: () => Promise.resolve({ status: 'finished', result }) }),
  }
}

const malformedRedactor: Guardrail = {
  name: 'redact-without-text',
  checkOutput: () => ({ action: 'redact' }),
}

describe('a guard defect in a guarded stream', () => {
  it('test_a_malformed_guard_result_makes_stream_reject_with_the_typed_error', async () => {
    const turn = await withGuardrails(finishedHandle('the word is BANANA'), [
      malformedRedactor,
    ]).send('say it')
    const stream = turn.stream as () => AsyncIterable<unknown>

    const seen: unknown[] = []
    const consumed = (async () => {
      for await (const message of stream()) seen.push(message)
    })()

    await expect(consumed).rejects.toBeInstanceOf(MalformedGuardrailResultError)
    // A defect is not an outcome: no terminal status message is yielded for it.
    expect(seen).toEqual([])
    await expect(turn.wait()).rejects.toBeInstanceOf(MalformedGuardrailResultError)
  })
})
