/**
 * M0 (theokit-ai-first) — deterministic end-to-end walking skeleton.
 *
 * Proves the Goal: a theokit agent's TEXT stream round-trips through the
 * ai-sdk `UIMessageStream` protocol and is reconstructed by the REAL ai-sdk
 * consumer transport (`parseJsonEventStream` + `readUIMessageStream`) — the
 * same code path `@ai-sdk/react`'s `useChat` uses internally — with NO custom
 * adapter.
 *
 * Chain under test:
 *   fixed AgentStreamEvent[]  (mock run.stream — no live LLM, D3/EC-2)
 *     → translateToUIMessageStream(..., { textId })   [@theokit/agents]
 *     → uiMessageStreamResponse(chunks)               [theokit/server/define]
 *     → parseJsonEventStream + readUIMessageStream     [ai — the consumer]
 *     → reconstructed text === emitted text
 *
 * Determinism: the event stream is fixed and `textId` is injected — the only
 * source of non-determinism (the message id) is pinned.
 *
 * The `uiMessageStreamResponse` import reaches into `packages/theo/src` by
 * relative path ON PURPOSE: this is a test-only composition of the two halves
 * of the split (agents translate, theo transports) to prove the full chain.
 * It is NOT a production dependency of `@theokit/agents` (the builder pulls
 * only the erased `UIMessageChunk` type, no theo runtime).
 */
import { parseJsonEventStream, readUIMessageStream, uiMessageChunkSchema } from 'ai'
import { describe, expect, it } from 'vitest'

import type { AgentStreamEvent } from '../../src/bridge/agent-stream-events.js'
import { translateToUIMessageStream } from '../../src/bridge/ui-message-stream-translator.js'
// Test-only cross-package composition — see file header.
import { uiMessageStreamResponse } from '../../../theo/src/server/define/ui-message-stream-response.js'

const TEXT_ID = 't0'

/** A fixed agent text run — what run.stream() + the bridge produce for "Hello, world". */
const FIXTURE_EVENTS: AgentStreamEvent[] = [
  { type: 'run_started', runId: 'run-1', agentName: 'echo' },
  { type: 'text_delta', content: 'Hello, ' },
  { type: 'text_delta', content: 'world' },
  {
    type: 'done',
    result: 'Hello, world',
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    durationMs: 1,
  },
]

async function* mockRunStream(events: AgentStreamEvent[]): AsyncIterable<AgentStreamEvent> {
  for (const ev of events) yield ev
}

/**
 * Reconstruct the assistant text from an SSE Response using ONLY ai-sdk consumer
 * primitives — the same parse path `useChat` runs. No theokit adapter involved.
 */
async function reconstructText(response: Response): Promise<string> {
  if (!response.body) throw new Error('response has no body')
  const parsed = parseJsonEventStream({ stream: response.body, schema: uiMessageChunkSchema })
  const chunkStream = new ReadableStream({
    async start(controller) {
      for await (const result of parsed) {
        if (!result.success) throw new Error(`ai-sdk rejected a chunk: ${String(result.error)}`)
        controller.enqueue(result.value)
      }
      controller.close()
    },
  })
  let text = ''
  for await (const message of readUIMessageStream({ stream: chunkStream })) {
    text = message.parts
      .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
      .map((part) => part.text)
      .join('')
  }
  return text
}

describe('UIMessageStream end-to-end (M0)', () => {
  it('test_usechat_transport_parses_theokit_text_without_custom_adapter', async () => {
    const response = uiMessageStreamResponse(
      translateToUIMessageStream(mockRunStream(FIXTURE_EVENTS), { textId: TEXT_ID }),
    )
    const text = await reconstructText(response)
    expect(text).toBe('Hello, world')
  })

  it('test_response_carries_ui_message_stream_v1_header', () => {
    const response = uiMessageStreamResponse(
      translateToUIMessageStream(mockRunStream(FIXTURE_EVENTS), { textId: TEXT_ID }),
    )
    expect(response.headers.get('x-vercel-ai-ui-message-stream')).toBe('v1')
  })
})
