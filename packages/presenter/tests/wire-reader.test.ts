import { describe, expect, it } from 'vitest'

import { createWireReader } from '../src/source/wire-reader.js'
import { WIRE_ERROR_CODE_PART, type WireChunk } from '../src/wire/chunk-schema.js'

describe('createWireReader', () => {
  it('a data-error-code frame followed by an error frame yields one error event with that code', () => {
    const reader = createWireReader()
    const out = [
      ...reader.read({ type: WIRE_ERROR_CODE_PART, data: { code: 'session_busy' } }),
      ...reader.read({ type: 'error', errorText: 'busy' }),
    ]
    expect(out).toEqual([{ type: 'error', message: 'busy', code: 'session_busy' }])
  })

  it('an error frame with no preceding code yields an error event without a code key', () => {
    const [event] = createWireReader().read({ type: 'error', errorText: 'x' })
    expect(event).toEqual({ type: 'error', message: 'x' })
    expect('code' in (event as object)).toBe(false)
  })

  it('the code is cleared after one error, and a lone code frame yields nothing', () => {
    const reader = createWireReader()
    expect(reader.read({ type: WIRE_ERROR_CODE_PART, data: { code: 'a' } })).toEqual([])
    reader.read({ type: 'error', errorText: 'one' })
    expect(reader.read({ type: 'error', errorText: 'two' })).toEqual([
      { type: 'error', message: 'two' },
    ])
  })

  it('the reader names a tool result from the earlier tool-input-available frame', () => {
    const reader = createWireReader()
    reader.read({
      type: 'tool-input-available',
      toolCallId: 'c1',
      toolName: 'read_file',
      input: {},
    } as WireChunk)
    const [event] = reader.read({
      type: 'tool-output-available',
      toolCallId: 'c1',
      output: 'ok',
    } as WireChunk)
    expect(event).toMatchObject({ type: 'tool-result', callId: 'c1', name: 'read_file' })
  })
})
