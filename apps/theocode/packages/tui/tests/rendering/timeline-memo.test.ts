/**
 * The collapse survives THIS PRODUCT'S formatter — the assertion the unit test cannot make.
 *
 * `tool-header.test.ts` pins that an explored tool is left unnamed. That proves the decision and not
 * that it reaches the timeline: `messagesToAgentEvents` is what actually groups, and it groups on the
 * name AFTER the formatter has run. A formatter that correctly returns `undefined` and a pipeline
 * that never calls it look identical from the unit's side — which is how the regression this file
 * exists to prevent got in, and it got in on a green suite.
 */
import { GOAL_CONTINUATION_MARKER } from '@theokit/sdk'
import { messagesToAgentEvents } from '@theokit/tui'
import { describe, expect, it } from 'vitest'

import { formatToolHeader, formatToolResult } from '../../src/formatting/index.js'
import { prepareThread } from '../../src/rendering/timeline-memo.js'

const read = (i: number) => ({
  type: 'tool-read_file',
  toolCallId: `c${i}`,
  state: 'output-available',
  input: {},
  output: 'ok',
})

function kinds(parts: readonly unknown[]): string[] {
  return messagesToAgentEvents([{ id: 'm', role: 'assistant', parts } as never], {
    formatToolHeader,
    formatToolResult,
  }).map((e) => e.kind)
}

describe('explored grouping, through the real formatter', () => {
  it('test_consecutive_reads_collapse_into_one_explored_block', () => {
    expect(
      kinds([read(1), read(2), read(3)]),
      'naming an explored tool opts it out of the collapse — three cards instead of one block',
    ).toEqual(['explored'])
  })

  it('test_a_named_tool_still_renders_as_its_own_card', () => {
    // Anti-vacuity: a pipeline that collapsed everything would satisfy the case above.
    expect(
      kinds([
        {
          type: 'tool-run_shell',
          toolCallId: 'c9',
          state: 'output-available',
          input: { command: 'echo hi' },
          output: 'hi',
        },
      ]),
    ).toEqual(['tool'])
  })
})

describe('a refused call, through the real formatter', () => {
  it('test_a_typed_refusal_renders_the_refusal_header_without_marker_text', () => {
    const [event] = messagesToAgentEvents(
      [
        {
          id: 'm',
          role: 'assistant',
          parts: [
            {
              type: 'tool-Bash',
              toolCallId: 'r1',
              state: 'output-error',
              input: { command: 'ls' },
              errorText: 'refused',
              refusal: { by: 'human' },
            },
          ],
        } as never,
      ],
      { formatToolHeader, formatToolResult },
    )

    expect(event).toMatchObject({ kind: 'tool', name: 'Rejected ls', status: 'failed' })
    expect(JSON.stringify(event)).not.toMatch(/denied by human approver|126/)
  })
})

describe('prepareThread — goal continuation', () => {
  it('test_a_goal_continuation_user_turn_is_collapsed', () => {
    const out = prepareThread([
      {
        id: 'u1',
        role: 'user',
        parts: [{ type: 'text', text: `${GOAL_CONTINUATION_MARKER} keep going` }],
      } as never,
      { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'hello' }] } as never,
    ])
    expect(out[0]?.parts).toEqual([{ type: 'text', text: '↻ continuing the goal…' }])
    expect(out[1]?.parts).toEqual([{ type: 'text', text: 'hello' }])
  })
})
