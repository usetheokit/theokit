/**
 * M0 (theokit-ai-first) — uiMessageStreamResponse.
 *
 * The theo-side transport half of the walking skeleton (D1). It serializes an
 * async iterable of ai-sdk `UIMessageChunk`s into a Web-Standards `Response`
 * that `@ai-sdk/react`'s `useChat` parses WITHOUT a custom adapter:
 *
 * - header `x-vercel-ai-ui-message-stream: v1` + `content-type: text/event-stream`
 * - body frames each chunk as `data: {json}\n\n`
 * - body terminates with `data: [DONE]\n\n`
 *
 * Web Standards only (Response + ReadableStream) — no node:http (G8).
 *
 * NOTE ON TEST LOCATION: theo (`theokit`) unit tests run from the repo-root
 * `tests/` tree via the root vitest config (`include: ['tests/**\/*.test.ts']`);
 * `packages/theo/tests/` is NOT collected. The plan named
 * `packages/theo/tests/unit/...` on a wrong assumption about the layout — this
 * file lives where it is actually executed (CLAUDE.md "code/README win").
 */
import { describe, expect, it } from 'vitest'
import type { UIMessageChunk } from 'ai'

import { uiMessageStreamResponse } from '../../packages/theo/src/server/define/ui-message-stream-response.js'

async function* fromChunks(chunks: UIMessageChunk[]): AsyncIterable<UIMessageChunk> {
  for (const c of chunks) yield c
}

async function readBody(response: Response): Promise<string> {
  if (!response.body) throw new Error('response has no body')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let out = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    out += decoder.decode(value, { stream: true })
  }
  out += decoder.decode()
  return out
}

const SAMPLE: UIMessageChunk[] = [
  { type: 'start' },
  { type: 'text-start', id: 't0' },
  { type: 'text-delta', id: 't0', delta: 'hi' },
  { type: 'text-end', id: 't0' },
  { type: 'finish' },
]

describe('uiMessageStreamResponse — SSE transport (M0)', () => {
  it('test_sets_ui_message_stream_headers', () => {
    const res = uiMessageStreamResponse(fromChunks(SAMPLE))
    expect(res.headers.get('x-vercel-ai-ui-message-stream')).toBe('v1')
    expect(res.headers.get('content-type')).toBe('text/event-stream')
  })

  it('test_frames_each_chunk_as_sse_data_line', async () => {
    const res = uiMessageStreamResponse(fromChunks(SAMPLE))
    const body = await readBody(res)
    for (const chunk of SAMPLE) {
      expect(body).toContain(`data: ${JSON.stringify(chunk)}\n\n`)
    }
  })

  it('test_terminates_with_done_marker', async () => {
    const res = uiMessageStreamResponse(fromChunks(SAMPLE))
    const body = await readBody(res)
    expect(body.endsWith('data: [DONE]\n\n')).toBe(true)
  })

  it('test_empty_iterable_still_emits_headers_and_done', async () => {
    const res = uiMessageStreamResponse(fromChunks([]))
    expect(res.headers.get('x-vercel-ai-ui-message-stream')).toBe('v1')
    const body = await readBody(res)
    expect(body).toBe('data: [DONE]\n\n')
  })
})
