import type { WireMessage } from '@theokit/presenter/wire'
import { describe, expect, it } from 'vitest'

import { transcriptToText } from '../../src/session/transcript-to-text.js'

const messages: WireMessage[] = [
  { id: '1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
  {
    id: '2',
    role: 'assistant',
    parts: [
      {
        type: 'dynamic-tool',
        toolName: 'ls',
        toolCallId: 't',
        state: 'output-available',
        input: { a: 1 },
        output: 'ok',
      },
      { type: 'text', text: 'done' },
    ],
  },
]

describe('transcriptToText', () => {
  it('renders role lines by default', () => {
    expect(transcriptToText(messages)).toBe(
      'user: hi\nassistant: done\n  [tool] ls({"a":1}) -> "ok"',
    )
  })
  it('renders one JSON message per line', () => {
    const lines = transcriptToText(messages, { format: 'jsonl' }).split('\n')
    expect(lines.map((l) => JSON.parse(l))).toEqual(messages)
  })
  it('renders markdown', () => {
    expect(transcriptToText(messages, { format: 'markdown' })).toBe(
      '## user\n\nhi\n\n## assistant\n\ndone\n\n- `ls({"a":1}) -> "ok"`',
    )
  })
  it('renders an empty thread as an empty string', () => {
    expect(transcriptToText([], { format: 'markdown' })).toBe('')
  })
})
