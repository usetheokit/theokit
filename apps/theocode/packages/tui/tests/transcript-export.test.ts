/**
 * B-075 — getting a reply out of the terminal.
 *
 * Nothing in `packages/tui/src` touched a clipboard or wrote a transcript. The only way to move an
 * answer elsewhere was mouse-selecting it out of a bordered box that hard-wraps every line — which
 * re-flows the code the answer usually contains.
 *
 * The serializer is pure and takes the timeline as an argument. The wrapping happens at RENDER
 * time, so serializing from the message data is what makes the export unwrapped — the bullet the
 * item calls the actual defect.
 */
import { describe, expect, it } from 'vitest'

import {
  conversationToMarkdown,
  lastAssistantText,
  type ExportableMessage,
} from '../src/transcript-export.js'

/**
 * Built from the shape `deriveTimeline` actually PRODUCES (`AgentEvent`), not from the shape the
 * SDK consumes. The first version of these tests used `{ role, parts[] }` and passed green while
 * `/export` reported every real conversation empty — a fixture that agrees with the code's wrong
 * assumption proves nothing.
 */
const msg = (role: string, text: string): ExportableMessage => ({ kind: 'message', role, text })

describe('B-075 — conversationToMarkdown', () => {
  it('test_labels_each_turn_by_role', () => {
    const md = conversationToMarkdown([
      msg('user', 'how do I build?'),
      msg('assistant', 'npm run build'),
    ])
    expect(md).toContain('## You')
    expect(md).toContain('how do I build?')
    expect(md).toContain('npm run build')
  })

  it('test_preserves_a_code_block_verbatim', () => {
    // The whole point: a long line inside a fence must survive at its original width. The render
    // wraps it to the box, and an export reproducing that wrap would have closed nothing.
    const long = 'const x = someVeryLongFunctionName(argumentOne, argumentTwo, argumentThree, four)'
    const md = conversationToMarkdown([msg('assistant', '```ts\n' + long + '\n```')])
    expect(md.split('\n').some((l) => l === long)).toBe(true)
  })

  it('test_ignores_events_that_are_not_messages', () => {
    // The timeline is heterogeneous: tool events carry no role or parts. Including them would emit
    // `undefined` into the document.
    const md = conversationToMarkdown([
      { id: 't1', kind: 'tool', name: 'run_shell', status: 'success' },
      { id: 'k1', kind: 'thinking', text: 'pondering' },
      msg('assistant', 'done'),
    ])
    expect(md).toContain('done')
    expect(md).not.toContain('undefined')
    expect(md).not.toContain('pondering')
  })

  it('test_an_empty_conversation_is_reported_not_faked', () => {
    expect(conversationToMarkdown([])).toBe('')
  })
})

describe('B-075 — lastAssistantText', () => {
  it('test_returns_the_most_recent_assistant_turn', () => {
    expect(
      lastAssistantText([msg('assistant', 'older'), msg('user', 'q'), msg('assistant', 'newest')]),
    ).toBe('newest')
  })

  it('test_is_undefined_when_the_assistant_has_not_spoken', () => {
    // Undefined rather than '': the caller must be able to say "nothing to copy" instead of
    // silently putting a blank on the clipboard.
    expect(lastAssistantText([msg('user', 'hello')])).toBeUndefined()
    expect(lastAssistantText([])).toBeUndefined()
  })

  it('test_does_not_return_the_user_turn_that_follows', () => {
    // Anti-vacuity floor: returning the last message of ANY role passes the first test and is wrong.
    expect(lastAssistantText([msg('assistant', 'reply'), msg('user', 'later')])).toBe('reply')
  })
})
