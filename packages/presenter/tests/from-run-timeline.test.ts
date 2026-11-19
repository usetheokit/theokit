import type { RunTimelineEvent } from '@theokit/sdk'
import { describe, expect, it } from 'vitest'

import {
  createRunTimelineState,
  flushRunTimeline,
  fromRunTimelineEvent,
  type RunTimelineEventLike,
} from '../src/index.js'

const run = (events: RunTimelineEventLike[]) => {
  const s = createRunTimelineState()
  return [...events.flatMap((e) => fromRunTimelineEvent(e, s)), ...flushRunTimeline(s)]
}
const delta = (update: unknown): RunTimelineEventLike => ({ kind: 'delta', update })
const msg = (
  message: Record<string, unknown>,
  textAlreadyStreamed?: boolean,
): RunTimelineEventLike => ({
  kind: 'message',
  message: message as never,
  textAlreadyStreamed,
})
const completedDelta = (callId: string, result: unknown) =>
  delta({ type: 'tool-call-completed', callId, toolCall: { name: 'sh', args: {}, result } })
const completedMsg = (callId: string, result: unknown) =>
  msg({ type: 'tool_call', status: 'completed', call_id: callId, name: 'sh', result })

describe('fromRunTimelineEvent', () => {
  it('a message with textAlreadyStreamed true emits no text but keeps its tool calls', () => {
    const out = run([
      msg(
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'text', text: 'Hi' },
              { type: 'tool_use', id: 'c1', name: 'sh', input: {} },
            ],
          },
        },
        true,
      ),
    ])
    expect(out.map((e) => e.type)).toEqual(['tool-call'])
  })

  it('thinking-delta then a coarse thinking message yields one reasoning event', () => {
    const out = run([
      delta({ type: 'thinking-delta', text: 'hmm' }),
      delta({ type: 'text-delta', text: 'Hi' }),
      msg({ type: 'thinking', text: 'hmm' }),
      msg({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hi' }] } }, true),
      msg({ type: 'status', status: 'FINISHED' }),
    ])
    expect(out.filter((e) => e.type === 'reasoning')).toHaveLength(1)
    expect(out.filter((e) => e.type === 'text')).toHaveLength(1)
    expect(out.at(-1)?.type).toBe('finish')
  })

  it.each([
    ['delta first', false],
    ['message first', true],
  ])(
    'a tool completed by delta and then by a message with exitCode 1 yields one tool-result with isError true (%s)',
    (_n, msgFirst) => {
      const d = completedDelta('c1', 'boom')
      const m = completedMsg('c1', { exitCode: 1 })
      const out = run(msgFirst ? [m, d] : [d, m]).filter((e) => e.type === 'tool-result')
      expect(out).toHaveLength(1)
      expect(out[0]).toMatchObject({ isError: true })
    },
  )

  it('a held tool result is released before the text that follows it', () => {
    const out = run([completedDelta('c1', 'ok'), delta({ type: 'text-delta', text: 'next' })])
    expect(out.map((e) => e.type)).toEqual(['tool-result', 'text'])
  })

  it('flushRunTimeline releases a result held when the run ends on a tool call', () => {
    const s = createRunTimelineState()
    expect(fromRunTimelineEvent(completedDelta('c1', 'ok'), s)).toEqual([])
    expect(flushRunTimeline(s)).toHaveLength(1)
    expect(flushRunTimeline(s)).toEqual([])
  })

  it('two states do not share ids', () => {
    const a = createRunTimelineState()
    const b = createRunTimelineState()
    fromRunTimelineEvent(completedDelta('c1', 'ok'), a)
    fromRunTimelineEvent(completedDelta('c1', 'ok'), b)
    expect(flushRunTimeline(a)).toHaveLength(1)
    expect(flushRunTimeline(b)).toHaveLength(1)
  })

  it('accepts the SDK RunTimelineEvent type', () => {
    const accept = (e: RunTimelineEvent) => fromRunTimelineEvent(e, createRunTimelineState())
    expect(typeof accept).toBe('function')
  })

  it('keeps several id-less tool calls visible', () => {
    const call = { type: 'tool_call', status: 'running', name: 'sh' }
    const out = run([msg(call), msg(call)])
    expect(out.filter((e) => e.type === 'tool-call')).toHaveLength(2)
    const block = { type: 'tool_use', name: 'sh', input: {} }
    const a = run([msg({ type: 'assistant', message: { content: [block, block] } })])
    expect(a.filter((e) => e.type === 'tool-call')).toHaveLength(2)
  })

  it('a discarded thinking repeat does not release a held result before its failure report', () => {
    const out = run([
      delta({ type: 'thinking-delta', text: 'hmm' }),
      completedDelta('c1', 'boom'),
      msg({ type: 'thinking', text: 'hmm' }),
      completedMsg('c1', { exitCode: 1 }),
    ]).filter((e) => e.type === 'tool-result')
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ isError: true })
  })
})
