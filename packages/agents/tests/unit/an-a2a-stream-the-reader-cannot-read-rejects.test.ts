/**
 * A remote whose frames the wire reader cannot read is not a remote that said nothing.
 *
 * The reader drops a frame whose JSON is invalid or whose variant it does not know. When every
 * content frame is dropped and `finish` still crosses, the turn reconstructs to no text, and an
 * empty answer is a legitimate reply. Returned as `''`, total frame loss reads as an agent that had
 * nothing to say (review finding F-dom-1). An empty turn after dropped frames rejects instead.
 */
import { describe, expect, it, vi } from 'vitest'

import { createA2ATool } from '../../src/a2a/a2a-client.js'

/** A 200 event stream carrying exactly these frames, one `data:` line each. */
function framesFetch(frames: string[]) {
  return vi.fn(async (_url: string, _init: RequestInit) => {
    const body = frames.map((f) => `data: ${f}\n\n`).join('')
    return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
  })
}

function tool(fetchImpl: ReturnType<typeof framesFetch>) {
  return createA2ATool({ url: 'https://x/agents/a', name: 'ask', description: 'd', fetchImpl })
}

describe('an A2A stream the reader cannot read', () => {
  it('test_a_finished_turn_with_no_text_after_dropped_frames_rejects_naming_the_count', async () => {
    const fetchImpl = framesFetch([
      '{"type":"start"}',
      '{"type":"text-delta-v9","id":"t","delta":"hi"}',
      'not json',
      '{"type":"finish"}',
    ])

    await expect(tool(fetchImpl).handler({ message: 'hi' })).rejects.toThrow(
      'A2A call to "ask" failed: no text after 2 unreadable frames',
    )
  })

  it('test_a_turn_with_text_beside_a_dropped_frame_returns_the_text', async () => {
    const fetchImpl = framesFetch([
      '{"type":"start"}',
      '{"type":"data-unknown-thing"}',
      '{"type":"text-start","id":"t"}',
      '{"type":"text-delta","id":"t","delta":"hello"}',
      '{"type":"text-end","id":"t"}',
      '{"type":"finish"}',
    ])

    expect(await tool(fetchImpl).handler({ message: 'hi' })).toBe('hello')
  })
})
