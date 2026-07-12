/**
 * M41/M42 — extractLastUserText: the shared helper the in-process + channel transports use to hand a
 * plain `message` string to their runner. Non-trivial branching (reverse scan, role filter, text-part
 * join) merits direct unit tests independent of the transports.
 */
import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'

import { extractLastUserText } from '../../packages/theo/src/client/last-user-text.js'

const user = (text: string): UIMessage => ({
  id: 'u',
  role: 'user',
  parts: [{ type: 'text', text }],
})
const assistant = (text: string): UIMessage => ({
  id: 'a',
  role: 'assistant',
  parts: [{ type: 'text', text }],
})

describe('extractLastUserText (M41/M42)', () => {
  it('returns empty string for an empty message list', () => {
    expect(extractLastUserText([])).toBe('')
  })

  it('returns empty string when there is no user message (assistant-only)', () => {
    expect(extractLastUserText([assistant('hi'), assistant('there')])).toBe('')
  })

  it('returns the LAST user message text (reverse scan)', () => {
    expect(extractLastUserText([user('first'), assistant('reply'), user('second')])).toBe('second')
  })

  it('joins multiple text parts of the last user message', () => {
    const msg: UIMessage = {
      id: 'u',
      role: 'user',
      parts: [
        { type: 'text', text: 'Hel' },
        { type: 'text', text: 'lo' },
      ],
    }
    expect(extractLastUserText([msg])).toBe('Hello')
  })

  it('skips a user message with no text parts and falls back to an earlier one', () => {
    const noText: UIMessage = { id: 'u2', role: 'user', parts: [] }
    expect(extractLastUserText([user('earlier'), noText])).toBe('earlier')
  })

  it('returns empty string when the only user message has no text parts', () => {
    const noText: UIMessage = { id: 'u', role: 'user', parts: [] }
    expect(extractLastUserText([noText])).toBe('')
  })
})
