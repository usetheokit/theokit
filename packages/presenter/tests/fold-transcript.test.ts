import { describe, expect, it } from 'vitest'

import {
  createRunTimelineState,
  EMPTY_TRANSCRIPT,
  flushRunTimeline,
  foldTranscript,
  fromRunTimelineEvent,
  type AgentOutputEvent,
  type RunTimelineEventLike,
  type TranscriptState,
} from '../src/index.js'

const fold = (events: AgentOutputEvent[], from: TranscriptState = EMPTY_TRANSCRIPT) =>
  events.reduce(foldTranscript, from)
const call = (callId = 'c1'): AgentOutputEvent => ({
  type: 'tool-call',
  callId,
  name: 'sh',
  input: { cmd: 'ls' },
})

describe('foldTranscript', () => {
  it('text, tool-call, tool-result, text yields message, tool, message', () => {
    const s = fold([
      { type: 'text', text: 'a' },
      { type: 'text', text: 'b' },
      call(),
      { type: 'tool-result', callId: 'c1', name: 'sh', result: 'ok' },
      { type: 'text', text: 'c' },
    ])
    expect(s.items.map((i) => i.kind)).toEqual(['message', 'tool', 'message'])
    expect(s.items[0]).toMatchObject({ id: 'message_0', text: 'ab' })
    expect(s.items[1]?.tool).toMatchObject({ status: 'success', input: { cmd: 'ls' } })
    expect(s.status).toBe('streaming')
  })

  it('a repeated call id updates one card and still closes the open message', () => {
    const s = fold([
      { type: 'partial-tool-call', callId: 'c1', name: 'sh', input: {} },
      { type: 'text', text: 'a' },
      call(),
      { type: 'text', text: 'b' },
    ])
    expect(s.items.map((i) => i.kind)).toEqual(['tool', 'message', 'message'])
    expect(s.items[0]?.tool?.status).toBe('running')
  })

  it('reasoning appends to the open reasoning item', () => {
    const s = fold([
      { type: 'reasoning', text: 'x' },
      { type: 'reasoning', text: 'y' },
    ])
    expect(s.items).toEqual([{ id: 'reasoning_0', kind: 'reasoning', text: 'xy' }])
  })

  it('partial-tool-call opens a pending card', () => {
    const s = fold([{ type: 'partial-tool-call', callId: 'c1', name: 'sh', input: '{' }])
    expect(s.items[0]?.tool?.status).toBe('pending')
  })

  it('a tool-result with isError true marks the tool failed and reads the shell exit code', () => {
    const result = JSON.stringify({ ok: true, stdout: 'a', stderr: 'b', exit_code: 2 })
    const s = fold([
      call(),
      { type: 'tool-result', callId: 'c1', name: 'sh', result, isError: true },
    ])
    expect(s.items[0]?.tool?.status).toBe('failed')
    expect(s.items[0]?.tool?.result).toMatchObject({ kind: 'shell', exitCode: 2 })
  })

  it('a tool-result without a call still shows a card', () => {
    const s = fold([{ type: 'tool-result', callId: 'z', name: 'sh', result: 'ok' }])
    expect(s.items[0]?.tool).toMatchObject({ name: 'sh', status: 'success' })
  })

  it('finish fails every running tool', () => {
    const s = fold([
      call('a'),
      { type: 'partial-tool-call', callId: 'b', name: 'x', input: 1 },
      { type: 'finish' },
    ])
    expect(s.status).toBe('done')
    expect(s.items.map((i) => i.tool?.status)).toEqual(['failed', 'failed'])
  })

  it('error fails every pending tool and records the code', () => {
    const s = fold([
      { type: 'partial-tool-call', callId: 'b', name: 'x', input: 1 },
      { type: 'error', message: 'boom', code: 'E1' },
    ])
    expect(s.status).toBe('error')
    expect(s.error).toEqual({ message: 'boom', code: 'E1' })
    expect(s.items.map((i) => i.kind)).toEqual(['tool', 'error'])
    expect(s.items[0]?.tool?.status).toBe('failed')
  })

  it('events after finish return the same state object', () => {
    const done = fold([{ type: 'text', text: 'a' }, { type: 'finish' }])
    expect(foldTranscript(done, { type: 'text', text: 'b' })).toBe(done)
    expect(foldTranscript(done, { type: 'error', message: 'x' })).toBe(done)
  })

  it('status events change nothing', () => {
    const s = fold([{ type: 'text', text: 'a' }])
    expect(foldTranscript(s, { type: 'status', status: 'RUNNING' })).toBe(s)
    expect(foldTranscript(EMPTY_TRANSCRIPT, { type: 'status', status: 'RUNNING' })).toBe(
      EMPTY_TRANSCRIPT,
    )
  })

  it('the fold never mutates its input state', () => {
    let s = fold([{ type: 'text', text: 'a' }, call()])
    const deep = (o: unknown): void => {
      if (typeof o === 'object' && o !== null && !Object.isFrozen(o)) {
        Object.freeze(o)
        Object.values(o).forEach(deep)
      }
    }
    deep(s)
    const events: AgentOutputEvent[] = [
      { type: 'text', text: 'b' },
      { type: 'reasoning', text: 'r' },
      call(),
      { type: 'tool-result', callId: 'c1', name: 'sh', result: 'x' },
      { type: 'error', message: 'e' },
    ]
    for (const e of events) s = foldTranscript(s, e)
    expect(s.status).toBe('error')
  })

  it('the SDK order through fromRunTimelineEvent yields one reasoning item and one message', () => {
    const delta = (update: unknown): RunTimelineEventLike => ({ kind: 'delta', update })
    const msg = (message: Record<string, unknown>, textAlreadyStreamed?: boolean) =>
      ({ kind: 'message', message, textAlreadyStreamed }) as RunTimelineEventLike
    const st = createRunTimelineState()
    const input: RunTimelineEventLike[] = [
      delta({ type: 'thinking-delta', text: 'hmm' }),
      delta({ type: 'text-delta', text: 'Hi' }),
      msg({ type: 'thinking', text: 'hmm' }),
      msg({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hi' }] } }, true),
      msg({ type: 'status', status: 'FINISHED' }),
    ]
    const events = [...input.flatMap((e) => fromRunTimelineEvent(e, st)), ...flushRunTimeline(st)]
    const s = fold(events)
    expect(s.items.map((i) => i.kind)).toEqual(['reasoning', 'message'])
    expect(s.items[1]?.text).toBe('Hi')
    expect(s.status).toBe('done')
  })
})
