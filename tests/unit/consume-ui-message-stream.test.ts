/**
 * M2 (theokit-ai-first) — consumeUIMessageStream: the client-side UIMessageStream reader.
 *
 * Reuses the `ai` package's own `parseJsonEventStream` + `readUIMessageStream` (the exact
 * path `@ai-sdk/react`'s `useChat` runs — Rule 9, no reinvented parser) to reconstruct the
 * assistant `UIMessage`s from a TheoKit agent endpoint's SSE `Response`. This is the pure,
 * DOM-free core the `useAgent` React hook is glue over.
 */
import { describe, expect, it } from 'vitest'

import { consumeUIMessageStream } from '../../packages/theo/src/client/consume-ui-message-stream.js'

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

  it('test_returns_without_calling_onMessage_when_body_is_null', async () => {
    let called = false
    // A HEAD-like response with a null body must not throw.
    await consumeUIMessageStream(new Response(null), () => {
      called = true
    })
    expect(called).toBe(false)
  })
})
