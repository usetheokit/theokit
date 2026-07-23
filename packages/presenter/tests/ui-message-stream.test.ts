import { describe, expect, it } from 'vitest'

import type { AgentOutputEvent } from '../src/agent-output-event.js'
import { UIMessageStreamPresenter } from '../src/presenters/ui-message-stream.js'

const TEXT_ID = 't-fixed'
const make = () => new UIMessageStreamPresenter({ textId: TEXT_ID })

/** Drive a whole event list through the presenter (start → present* → finish) and collect the chunks. */
function run(events: AgentOutputEvent[], meta?: Parameters<UIMessageStreamPresenter['finish']>[0]) {
  const p = make()
  const out = [...p.start()]
  for (const e of events) out.push(...p.present(e))
  out.push(...p.finish(meta))
  return out
}

// M49 T0.4 — the web presenter reproduces the original translator's chunk sequences byte-for-byte
// (pure-output events). This is the zero-behavior oracle at the presenter level.
describe('UIMessageStreamPresenter (M49 — web surface, zero-behavior port)', () => {
  it("start emits exactly one { type: 'start' }", () => {
    expect(make().start()).toEqual([{ type: 'start' }])
  })

  it('text run: start → text-start → text-delta* → text-end → finish', () => {
    expect(
      run([
        { type: 'text', text: 'he' },
        { type: 'text', text: 'llo' },
      ]),
    ).toEqual([
      { type: 'start' },
      { type: 'text-start', id: TEXT_ID },
      { type: 'text-delta', id: TEXT_ID, delta: 'he' },
      { type: 'text-delta', id: TEXT_ID, delta: 'llo' },
      { type: 'text-end', id: TEXT_ID },
      { type: 'finish' },
    ])
  })

  it('reasoning collapses consecutive events into ONE block with a minted id', () => {
    const out = run([
      { type: 'reasoning', text: 'th' },
      { type: 'reasoning', text: 'ink' },
    ])
    expect(out[0]).toEqual({ type: 'start' })
    expect(out[1]).toMatchObject({ type: 'reasoning-start' })
    const rid = (out[1] as { id: string }).id
    expect(out[2]).toEqual({ type: 'reasoning-delta', id: rid, delta: 'th' })
    expect(out[3]).toEqual({ type: 'reasoning-delta', id: rid, delta: 'ink' })
    expect(out[4]).toEqual({ type: 'reasoning-end', id: rid })
    expect(out[5]).toEqual({ type: 'finish' })
  })

  it('switching from text to a tool closes the open text block first (EC-2)', () => {
    expect(
      run([
        { type: 'text', text: 'run:' },
        { type: 'tool-call', callId: 'c1', name: 'sh', input: { cmd: 'ls' } },
      ]),
    ).toEqual([
      { type: 'start' },
      { type: 'text-start', id: TEXT_ID },
      { type: 'text-delta', id: TEXT_ID, delta: 'run:' },
      { type: 'text-end', id: TEXT_ID },
      {
        type: 'tool-input-available',
        toolCallId: 'c1',
        toolName: 'sh',
        input: { cmd: 'ls' },
        dynamic: true,
      },
      { type: 'finish' },
    ])
  })

  it('tool-result for a callId never introduced synthesizes tool-input-available first (EC-1)', () => {
    expect(run([{ type: 'tool-result', callId: 'c9', name: 'grep', result: 'ok' }])).toEqual([
      { type: 'start' },
      {
        type: 'tool-input-available',
        toolCallId: 'c9',
        toolName: 'grep',
        input: {},
        dynamic: true,
      },
      { type: 'tool-output-available', toolCallId: 'c9', output: 'ok' },
      { type: 'finish' },
    ])
  })

  it('a tool error → tool-output-error with the error text', () => {
    const out = run([
      { type: 'tool-call', callId: 'c1', name: 'sh', input: {} },
      { type: 'tool-result', callId: 'c1', name: 'sh', result: 'boom', isError: true },
    ])
    expect(out).toContainEqual({ type: 'tool-output-error', toolCallId: 'c1', errorText: 'boom' })
  })

  it('a run error surfaces an ai-sdk error chunk', () => {
    const p = make()
    expect(p.present({ type: 'error', message: 'kaboom' })).toEqual([
      { type: 'error', errorText: 'kaboom' },
    ])
  })

  it('partial-tool-call emits no chunk (args shown on the committed tool-call)', () => {
    const p = make()
    expect(
      p.present({ type: 'partial-tool-call', callId: 'c1', name: 'sh', input: { cmd: 'l' } }),
    ).toEqual([])
  })

  it('finish with turn metadata rides messageMetadata; bare finish otherwise', () => {
    const meta = { usage: { totalTokens: 42 }, durationMs: 10, cost: 0.01 }
    expect(run([{ type: 'text', text: 'x' }], meta).at(-1)).toEqual({
      type: 'finish',
      messageMetadata: meta,
    })
    expect(run([{ type: 'text', text: 'x' }]).at(-1)).toEqual({ type: 'finish' })
  })
})
