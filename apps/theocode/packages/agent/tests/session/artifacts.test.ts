import { describe, expect, it } from 'vitest'

import { classifyEntry } from '../../src/session/artifacts.js'

describe('classifyEntry — temp files', () => {
  it('leaves a foreign .tmp file alone', () => {
    expect(classifyEntry('notes.tmp', false)).toBeUndefined()
    expect(classifyEntry('x.jsonl.swp.tmp', false)).toBeUndefined()
  })

  it('claims the SDK atomic writer temp file', () => {
    expect(classifyEntry('abc.jsonl.1234.0123456789abcdef.tmp', false)).toBe('tmp')
  })
})
