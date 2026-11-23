import { describe, expect, it } from 'vitest'

import { threadToUIMessages } from '../../src/session/thread-to-ui-messages.js'

const user = (uuid: string, content: unknown[]) => ({
  type: 'user',
  uuid,
  parentUuid: null,
  message: { role: 'user', content },
})
const assistant = (uuid: string, content: unknown[]) => ({
  type: 'assistant',
  uuid,
  parentUuid: null,
  message: { role: 'assistant', id: `m-${uuid}`, type: 'message', content },
})

describe('threadToUIMessages', () => {
  it('pairs a tool call with its result into one assistant message', () => {
    const out = threadToUIMessages([
      user('u1', [{ type: 'text', text: 'list files' }]),
      assistant('a1', [{ type: 'tool_use', id: 't1', name: 'ls', input: { dir: '.' } }]),
      user('u2', [{ type: 'tool_result', tool_use_id: 't1', content: 'a.txt' }]),
      assistant('a2', [{ type: 'text', text: 'one file' }]),
    ])
    expect(out.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(out[1]?.parts).toEqual([
      {
        type: 'dynamic-tool',
        toolName: 'ls',
        toolCallId: 't1',
        state: 'output-available',
        input: { dir: '.' },
        output: 'a.txt',
      },
      { type: 'text', text: 'one file' },
    ])
  })

  it('leaves a call with no result in input-available', () => {
    const out = threadToUIMessages([
      assistant('a1', [{ type: 'tool_use', id: 't1', name: 'ls', input: {} }]),
    ])
    expect(out[0]?.parts[0]).toMatchObject({ toolCallId: 't1', state: 'input-available' })
  })

  it('marks an error result and skips records without a message', () => {
    const out = threadToUIMessages([
      { type: 'system', uuid: 's', subtype: 'compact_boundary' },
      assistant('a1', [{ type: 'tool_use', id: 't1', name: 'x', input: 1 }]),
      user('u2', [
        { type: 'tool_result', tool_use_id: 't1', content: 'boom', is_error: true },
        { type: 'tool_result', tool_use_id: 'ghost', content: 'orphan' },
      ]),
    ])
    expect(out).toHaveLength(1)
    expect(out[0]?.parts[0]).toMatchObject({ state: 'output-error', errorText: 'boom' })
  })
})
