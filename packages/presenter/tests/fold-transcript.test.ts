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
  name: 'shell_exec',
  input: { cmd: 'ls' },
})

describe('foldTranscript', () => {
  it('text, tool-call, tool-result, text yields message, tool, message', () => {
    const s = fold([
      { type: 'text', text: 'a' },
      { type: 'text', text: 'b' },
      call(),
      { type: 'tool-result', callId: 'c1', name: 'shell_exec', result: 'ok' },
      { type: 'text', text: 'c' },
    ])
    expect(s.items.map((i) => [i.id, i.kind, i.text])).toEqual([
      ['message_0', 'message', 'ab'],
      ['c1', 'tool', undefined],
      ['message_2', 'message', 'c'],
    ])
    expect(s.items[1]?.tool?.status).toBe('success')
    expect(s.status).toBe('streaming')
  })

  it('reasoning appends to the open reasoning item', () => {
    const s = fold([
      { type: 'reasoning', text: 'h' },
      { type: 'reasoning', text: 'm' },
    ])
    expect(s.items).toEqual([{ id: 'reasoning_0', kind: 'reasoning', text: 'hm' }])
  })

  it('a repeated call id updates one card', () => {
    const s = fold([
      { type: 'partial-tool-call', callId: 'c1', name: 'shell_exec', input: { cmd: 'l' } },
      { type: 'partial-tool-call', callId: 'c1', name: 'shell_exec', input: { cmd: 'ls' } },
    ])
    expect(s.items).toHaveLength(1)
    expect(s.items[0]?.tool).toMatchObject({ status: 'pending', input: { cmd: 'ls' } })
    const r = fold([call()], s)
    expect(r.items).toHaveLength(1)
    expect(r.items[0]?.tool?.status).toBe('running')
  })

  it('a tool-call for a call id that already has a result sets the card running with the new input', () => {
    const s = fold([
      call(),
      { type: 'tool-result', callId: 'c1', name: 'shell_exec', result: 'ok' },
      { type: 'tool-call', callId: 'c1', name: 'shell_exec', input: { cmd: 'pwd' } },
    ])
    expect(s.items).toHaveLength(1)
    expect(s.items[0]?.tool).toEqual({
      callId: 'c1',
      name: 'shell_exec',
      input: { cmd: 'pwd' },
      status: 'running',
    })
  })

  it('a repeated tool-call closes the open message, so later text opens a new one', () => {
    const s = fold([call(), { type: 'text', text: 'a' }, call(), { type: 'text', text: 'b' }])
    expect(s.items.map((i) => [i.kind, i.text])).toEqual([
      ['tool', undefined],
      ['message', 'a'],
      ['message', 'b'],
    ])
  })

  it('a repeated tool-call keeps the first card between the messages around it', () => {
    const s = fold([
      { type: 'text', text: 'A' },
      call(),
      { type: 'text', text: 'B' },
      call(),
      { type: 'text', text: 'C' },
    ])
    expect(s.items.map((i) => [i.kind, i.text])).toEqual([
      ['message', 'A'],
      ['tool', undefined],
      ['message', 'B'],
      ['message', 'C'],
    ])
  })

  it('tool inputs that are not plain data are changed unless identical, and cycles do not recurse', () => {
    const at = (input: unknown): AgentOutputEvent => ({
      type: 'tool-call',
      callId: 'c1',
      name: 'x',
      input,
    })
    const d = fold([at(new Date(1))])
    expect(foldTranscript(d, at(new Date(2))).items[0]?.tool?.input).toEqual(new Date(2))
    const m = fold([at(new Map([[1, 1]]))])
    const m2 = foldTranscript(m, at(new Map([[2, 2]])))
    expect(m2).not.toBe(m)
    expect(m2.items[0]?.tool?.input).toEqual(new Map([[2, 2]]))
    // arrays of different length are not equal even when they have no own keys
    const e = fold([at([])])
    const sparse: unknown[] = []
    sparse.length = 2
    expect(foldTranscript(e, at(sparse))).not.toBe(e)
    const mk = () => {
      const o: Record<string, unknown> = {}
      o.self = o
      return o
    }
    const c = fold([at(mk())])
    expect(() => foldTranscript(c, at(mk()))).not.toThrow()
    expect(foldTranscript(c, at(mk()))).not.toBe(c)
  })

  it('identical repeated tool events return the same state object', () => {
    const partial: AgentOutputEvent = {
      type: 'partial-tool-call',
      callId: 'c1',
      name: 'x',
      input: { a: [1] },
    }
    const p1 = fold([partial])
    expect(foldTranscript(p1, { ...partial, input: { a: [1] } })).toBe(p1)
    const c1 = fold([call()])
    expect(foldTranscript(c1, call())).toBe(c1)
  })

  it('a tool-result with isError true marks the tool failed and reads the shell exit code', () => {
    const result = JSON.stringify({ ok: true, stdout: 'a', stderr: 'b', exit_code: 2 })
    const s = fold([
      call(),
      { type: 'tool-result', callId: 'c1', name: 'shell_exec', result, isError: true },
    ])
    expect(s.items[0]?.tool).toMatchObject({
      status: 'failed',
      input: { cmd: 'ls' },
      result: { kind: 'shell', exitCode: 2 },
    })
  })

  it('finish fails every running tool', () => {
    const s = fold([call('a'), call('b'), { type: 'finish' }])
    expect(s.status).toBe('done')
    expect(s.items.map((i) => i.tool?.status)).toEqual(['failed', 'failed'])
  })

  it('error fails every pending tool and records the code', () => {
    const s = fold([
      { type: 'partial-tool-call', callId: 'p', name: 'x', input: {} },
      { type: 'error', message: 'boom', code: 'E1' },
    ])
    expect(s.status).toBe('error')
    expect(s.error).toEqual({ message: 'boom', code: 'E1' })
    expect(s.items[0]?.tool?.status).toBe('failed')
    expect(s.items[1]).toMatchObject({ kind: 'error', text: 'boom' })
  })

  it('events after finish return the same state object', () => {
    const done = fold([{ type: 'text', text: 'a' }, { type: 'finish' }])
    expect(foldTranscript(done, { type: 'text', text: 'b' })).toBe(done)
    expect(foldTranscript(done, { type: 'error', message: 'x' })).toBe(done)
  })

  it('status events do not change the transcript', () => {
    expect(foldTranscript(EMPTY_TRANSCRIPT, { type: 'status', status: 'x' })).toBe(EMPTY_TRANSCRIPT)
  })

  it('the fold never mutates its input state', () => {
    let s: TranscriptState = EMPTY_TRANSCRIPT
    const events: AgentOutputEvent[] = [
      { type: 'text', text: 'a' },
      { type: 'text', text: 'b' },
      call(),
      { type: 'tool-result', callId: 'c1', name: 'shell_exec', result: 'ok' },
      { type: 'reasoning', text: 'r' },
      { type: 'finish' },
    ]
    for (const e of events) {
      s = foldTranscript(s, e)
      Object.freeze(s)
      Object.freeze(s.items)
      for (const i of s.items) {
        Object.freeze(i)
        if (i.tool) Object.freeze(i.tool)
      }
    }
    expect(s.status).toBe('done')
  })

  it('the SDK order through fromRunTimelineEvent yields one reasoning item and one message', () => {
    const delta = (update: unknown): RunTimelineEventLike => ({ kind: 'delta', update })
    const msg = (
      m: Record<string, unknown>,
      textAlreadyStreamed?: boolean,
    ): RunTimelineEventLike => ({
      kind: 'message',
      message: m as never,
      textAlreadyStreamed,
    })
    const timeline = createRunTimelineState()
    const events = [
      delta({ type: 'thinking-delta', text: 'hmm' }),
      delta({ type: 'text-delta', text: 'Hi' }),
      msg({ type: 'thinking', text: 'hmm' }),
      msg({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hi' }] } }, true),
      msg({ type: 'status', status: 'FINISHED' }),
    ]
    const out = [
      ...events.flatMap((e) => fromRunTimelineEvent(e, timeline)),
      ...flushRunTimeline(timeline),
    ]
    const s = fold(out)
    expect(s.items.map((i) => [i.kind, i.text])).toEqual([
      ['reasoning', 'hmm'],
      ['message', 'Hi'],
    ])
    expect(s.status).toBe('done')
  })
})
