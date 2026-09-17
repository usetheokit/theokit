import { describe, expect, it } from 'vitest'

import type { AgentOutputEvent } from '../src/agent-output-event.js'
import { ChatPresenter } from '../src/presenters/chat.js'

/**
 * B-019 — agent output reaches a chat channel through a presenter, not a hand-written loop.
 *
 * The defect this closes was observed on a real phone: a reply arrived as `"TheOi! 👋"`, the
 * `"The"` being a fragment of the model's reasoning, because the hand-written loop in `appteste`
 * took every frame carrying a delta. `AgentOutputEvent` is a discriminated union of eight
 * variants, so here that cannot happen by construction.
 */
const run = (p: ChatPresenter, events: AgentOutputEvent[]): unknown[] => [
  ...(p.start?.() ?? []),
  ...events.flatMap((e) => p.present(e)),
  ...(p.finish?.() ?? []),
]

describe('ChatPresenter', () => {
  it('emits exactly ONE message for a whole turn', () => {
    const out = run(new ChatPresenter({ channel: { id: 'c1', type: 'dm' } }), [
      { type: 'text', text: 'Hello ' },
      { type: 'text', text: 'world' },
      { type: 'finish' },
    ])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ text: 'Hello world', channel: { id: 'c1', type: 'dm' } })
  })

  it('never lets reasoning reach the channel — the "TheOi!" regression', () => {
    const out = run(new ChatPresenter({ channel: { id: 'c1', type: 'dm' } }), [
      { type: 'reasoning', text: 'The user greeted me, so' },
      { type: 'text', text: 'Oi! 👋' },
      { type: 'finish' },
    ])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ text: 'Oi! 👋' })
    expect(JSON.stringify(out)).not.toContain('The user greeted me')
  })

  it('drops partial tool calls, tool calls, results and status by default', () => {
    const out = run(new ChatPresenter({ channel: { id: 'c1', type: 'dm' } }), [
      { type: 'partial-tool-call', callId: '1', name: 'weather', input: { c: 'Sã' } },
      { type: 'tool-call', callId: '1', name: 'weather', input: { city: 'São Paulo' } },
      { type: 'tool-result', callId: '1', name: 'weather', result: 'sunny' },
      { type: 'status', status: 'active' },
      { type: 'text', text: 'It is sunny.' },
      { type: 'finish' },
    ])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ text: 'It is sunny.' })
  })

  it('tells the user a run failed, without leaking the error message or code', () => {
    const out = run(new ChatPresenter({ channel: { id: 'c1', type: 'dm' } }), [
      { type: 'error', message: 'ECONNREFUSED 10.0.0.4:5432 while reading secrets', code: 'E_DB' },
      { type: 'finish' },
    ])
    expect(out).toHaveLength(1)
    const body = JSON.stringify(out[0])
    expect(body).not.toContain('ECONNREFUSED')
    expect(body).not.toContain('E_DB')
    expect(out[0]).toMatchObject({ text: expect.stringMatching(/\S/) })
  })

  it('applies the injected dialect, and knows nothing about platforms itself', () => {
    const toWhatsApp = (t: string): string => t.replace(/\*\*(.+?)\*\*/g, '*$1*')
    const out = run(
      new ChatPresenter({ channel: { id: 'c1', type: 'dm' }, translate: toWhatsApp }),
      [{ type: 'text', text: '**Bom Sucesso (MG)**' }, { type: 'finish' }],
    )
    expect(out[0]).toMatchObject({ text: '*Bom Sucesso (MG)*' })
  })

  it('emits nothing for a turn that produced no text and no error', () => {
    const out = run(new ChatPresenter({ channel: { id: 'c1', type: 'dm' } }), [
      { type: 'status', status: 'active' },
      { type: 'finish' },
    ])
    expect(out).toEqual([])
  })

  it('is registrable, and the registry resolves it by surface', () => {
    expect(new ChatPresenter({ channel: { id: 'c1', type: 'dm' } }).surface).toBe('chat')
  })
})
