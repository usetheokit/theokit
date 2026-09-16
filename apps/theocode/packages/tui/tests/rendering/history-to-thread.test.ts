/**
 * #70 — turning a stored session into what the timeline draws.
 *
 * The two shapes do not meet. The SDK's `SessionMessagePart` is Claude-shaped — `tool_use` and
 * `tool_result` are SEPARATE parts joined by an id — and `messagesToAgentEvents` wants ONE part per
 * call, typed `tool-<name>`, carrying input and output together.
 *
 * Measured before writing any of this, because the failure mode is silent: feeding the raw SDK parts
 * to `messagesToAgentEvents` returns the text event and DROPS the tool parts entirely. A resume built
 * that way renders the prose and loses every command the agent ran — a screen that looks complete and
 * is not, which is worse than the empty one this fixes.
 */
import { messagesToAgentEvents } from '@theokit/tui'
import { describe, expect, it } from 'vitest'

import { formatToolHeader, formatToolResult } from '../../src/formatting/index.js'
import { historyToThread } from '../../src/rendering/history-to-thread.js'

const events = (messages: Parameters<typeof historyToThread>[0]) =>
  messagesToAgentEvents(historyToThread(messages) as never, { formatToolHeader, formatToolResult })

describe('#70 — a stored session becomes a drawable thread', () => {
  it('test_prose_survives_the_round_trip', () => {
    const out = events([{ role: 'assistant', text: 'hello', parts: [{ type: 'text', text: 'hello' }] }])

    expect(out.map((e) => e.kind)).toEqual(['message'])
    expect(JSON.stringify(out)).toContain('hello')
  })

  it('test_a_completed_tool_call_renders_as_a_tool_card', () => {
    // The assertion the whole module exists for: the raw shape produces NOTHING here.
    const out = events([
      {
        role: 'assistant',
        text: '',
        parts: [
          { type: 'tool_use', id: 'c1', name: 'run_shell', input: { command: 'echo x' } },
          { type: 'tool_result', toolUseId: 'c1', content: 'x' },
        ],
      },
    ])

    const tool = out.find((e) => e.kind === 'tool')
    expect(tool, 'the tool call was dropped — the exact silent loss this module prevents').toBeDefined()
    expect(tool).toMatchObject({ id: 'c1', status: 'success', output: 'x' })
  })

  it('test_a_result_in_a_LATER_message_is_still_paired', () => {
    // Found in a real transcript, not imagined: the Claude shape puts `tool_result` in the message
    // AFTER the call, so a merge that only looked inside one message left every card `running` — and
    // `deriveTimeline` drops running tools from history, so the command vanished from the screen
    // while the mapping looked like it worked.
    const out = events([
      {
        role: 'assistant',
        text: '',
        parts: [{ type: 'tool_use', id: 'c9', name: 'run_shell', input: { command: 'echo hi' } }],
      },
      { role: 'user', text: '', parts: [{ type: 'tool_result', toolUseId: 'c9', content: 'hi' }] },
    ])

    expect(out.find((e) => e.kind === 'tool')).toMatchObject({ status: 'success', output: 'hi' })
  })

  it('test_a_message_holding_only_a_result_does_not_become_an_empty_turn', () => {
    // That carrier message has no prose of its own. Rendering it would put a blank user turn on
    // screen under every tool call.
    const out = historyToThread([
      {
        role: 'assistant',
        text: '',
        parts: [{ type: 'tool_use', id: 'c9', name: 'run_shell', input: { command: 'echo hi' } }],
      },
      { role: 'user', text: '', parts: [{ type: 'tool_result', toolUseId: 'c9', content: 'hi' }] },
    ])

    expect(out.map((m) => m.parts.length)).toEqual([1])
  })

  it('test_a_failed_tool_call_keeps_its_failure', () => {
    const out = events([
      {
        role: 'assistant',
        text: '',
        parts: [
          { type: 'tool_use', id: 'c2', name: 'run_shell', input: { command: 'false' } },
          { type: 'tool_result', toolUseId: 'c2', content: 'boom', isError: true },
        ],
      },
    ])

    expect(out.find((e) => e.kind === 'tool')).toMatchObject({ status: 'failed', output: 'boom' })
  })

  it('test_a_call_whose_result_never_arrived_is_not_reported_as_success', () => {
    // A transcript can end mid-call. Claiming success for a result nobody has is fabrication.
    const out = events([
      {
        role: 'assistant',
        text: '',
        parts: [{ type: 'tool_use', id: 'c3', name: 'run_shell', input: { command: 'sleep 9' } }],
      },
    ])

    expect(out.find((e) => e.kind === 'tool' && e.status === 'success')).toBeUndefined()
  })

  it('test_a_message_with_no_parts_still_renders_its_text', () => {
    // `parts` is optional upstream — absent means "this projection carries no structure", never
    // "this turn had none". Dropping the message would lose a whole turn.
    const out = events([{ role: 'user', text: 'why is the build red?' }])

    expect(JSON.stringify(out)).toContain('why is the build red?')
  })

  it('test_ids_are_stable_across_two_calls', () => {
    // The timeline keys on them. Ids minted from a counter would re-key every render.
    const input = [{ role: 'assistant' as const, text: 'a', parts: [{ type: 'text' as const, text: 'a' }] }]

    expect(historyToThread(input)).toEqual(historyToThread(input))
  })

  it('test_an_empty_history_is_an_empty_thread', () => {
    expect(historyToThread([])).toEqual([])
  })
})
