/**
 * M2 (theokit-ai-first) — consumeUIMessageStream: the client-side UIMessageStream reader.
 *
 * Reuses the `ai` package's own `parseJsonEventStream` + `readUIMessageStream` (the exact
 * path `@ai-sdk/react`'s `useChat` runs — Rule 9, no reinvented parser) to reconstruct the
 * assistant `UIMessage`s from a TheoKit agent endpoint's SSE `Response`. This is the pure,
 * DOM-free core the `useAgent` React hook is glue over.
 */
import { describe, expect, it } from 'vitest'

// By the package specifier, not the `src` path: that is how the SUT imports it
// (`consume-ui-message-stream.ts:1`), and a second copy of the class would make `instanceof` fail
// against an error that is, in every other respect, the same.
import { WireStreamError } from '@theokit/presenter/wire'

import { consumeUIMessageStream } from '../../packages/agents/src/client/consume-ui-message-stream.js'

/** Build a fake SSE Response on the UIMessageStream wire from a list of chunks. */
function sseResponse(chunks: Array<Record<string, unknown>>): Response {
  const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n'
  return new Response(body, {
    headers: { 'content-type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' },
  })
}

describe('consumeUIMessageStream (M2)', () => {
  it('test_reconstructs_assistant_text_message_from_uimessagestream', async () => {
    const response = sseResponse([
      { type: 'start' },
      { type: 'text-start', id: 't0' },
      { type: 'text-delta', id: 't0', delta: 'Hel' },
      { type: 'text-delta', id: 't0', delta: 'lo' },
      { type: 'text-end', id: 't0' },
      { type: 'finish' },
    ])

    const snapshots: string[] = []
    await consumeUIMessageStream(response, (message) => {
      const text = message.parts
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('')
      snapshots.push(text)
    })

    // The final reconstructed snapshot is the full assistant text.
    expect(snapshots.at(-1)).toBe('Hello')
  })

  it('test_finish_message_metadata_lands_on_reconstructed_message_metadata', async () => {
    // The seam the TUI status bar / cost meter reads: the translator rides the turn's usage on the
    // finish chunk's `messageMetadata`; ai-sdk's readUIMessageStream (this reader) lands it on the
    // reconstructed assistant `UIMessage.metadata` — with NO extra header/store wiring. Boundary test
    // for the packages/agents translator change (the unit test asserts the chunk; this asserts the
    // client reconstruction the store/`useAgent` actually observes).
    const meta = {
      usage: { inputTokens: 12, outputTokens: 34, totalTokens: 46 },
      durationMs: 1234,
      cost: 0.0021,
    }
    const response = sseResponse([
      { type: 'start' },
      { type: 'text-start', id: 't0' },
      { type: 'text-delta', id: 't0', delta: 'hi' },
      { type: 'text-end', id: 't0' },
      { type: 'finish', messageMetadata: meta },
    ])
    let lastMetadata: unknown
    await consumeUIMessageStream(response, (message) => {
      lastMetadata = (message as { metadata?: unknown }).metadata
    })
    expect(lastMetadata).toEqual(meta)
  })

  it('test_surfaces_error_chunk_then_raises_a_typed_refusal', async () => {
    // A run that fails mid-stream emits an `error` chunk + `finish`.
    //
    // This test asserted the opposite: *"the reader must still terminate cleanly (no throw)"*.
    // theokit#136 decided the other way and the implementation followed — `read-message-stream.ts`
    // calls `raiseStreamError`, and the comment in the code is explicit: *"thrown, never swallowed"*.
    // Terminating cleanly would leave the consumer with a truncated turn and no signal that it
    // failed: the silent failure mode `.claude/rules/error-handling.md` forbids. The test went red at
    // that commit, freezing a contract the product had already abandoned — and red by default
    // protects nothing. Backlog B-M67-01, item 8.
    //
    // What it always meant to protect is still here, and it is what the refusal must preserve: the
    // partial text produced BEFORE the error already reached the consumer. Failing loud cannot mean
    // swallowing what was already true.
    const response = sseResponse([
      { type: 'start' },
      { type: 'text-start', id: 't0' },
      { type: 'text-delta', id: 't0', delta: 'partial' },
      { type: 'error', errorText: 'boom' },
      { type: 'finish' },
    ])
    let calls = 0
    let lastText = ''
    await expect(
      consumeUIMessageStream(response, (message) => {
        calls += 1
        lastText = message.parts
          .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
          .map((p) => p.text)
          .join('')
      }),
    ).rejects.toThrow(WireStreamError)

    // The refusal carries the message the server reported — "it failed" is not actionable; "it
    // failed, and the server said `boom`" is.
    await expect(
      consumeUIMessageStream(
        sseResponse([{ type: 'start' }, { type: 'error', errorText: 'boom' }]),
        () => {},
      ),
    ).rejects.toThrow(/boom/)

    expect(calls, 'the partial before the error must have reached the consumer').toBeGreaterThan(0)
    expect(lastText).toBe('partial')
  })

  it('test_returns_without_calling_onMessage_when_body_is_null', async () => {
    let called = false
    // A HEAD-like response with a null body must not throw.
    await consumeUIMessageStream(new Response(null), () => {
      called = true
    })
    expect(called).toBe(false)
  })
})
