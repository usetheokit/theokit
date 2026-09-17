import { describe, expect, it } from 'vitest'

import type { AgentOutputEvent } from '../src/agent-output-event.js'
import type { Presenter } from '../src/presenter.js'
import { ChatPresenter, type ChatMessage } from '../src/presenters/chat.js'

/**
 * B-019 — agent output reaches a chat channel through a presenter, not a hand-written loop.
 *
 * The defect this closes was observed on a real phone: a reply arrived as `"TheOi! 👋"`, the
 * `"The"` being a fragment of the model's reasoning, because the hand-written loop in `appteste`
 * took every frame carrying a delta. `AgentOutputEvent` is a discriminated union of eight
 * variants, so here that cannot happen by construction.
 */
/**
 * Drive a presenter the way a host does — through the INTERFACE, never the class.
 *
 * `start?()` and `finish?()` are optional members of `Presenter<TOut>`; `implements` does not add
 * them to the implementing class's own type, so typing this parameter as `ChatPresenter` made
 * `p.start?.()` a TS2339 even though the call is correct at runtime. That broke `pnpm typecheck` on
 * `workspace` and blocked another session's PR — caught by them, not by this package's own suite,
 * because `vitest run` here does not typecheck.
 *
 * Typing it as the interface is also the shape a consumer actually has: `PresenterRegistry.resolve`
 * hands back `Presenter<TOut>`, so a test bound to the concrete class exercises something nobody
 * does.
 */
const run = (p: Presenter<ChatMessage>, events: AgentOutputEvent[]): unknown[] => [
  ...(p.start?.() ?? []),
  ...events.flatMap((e) => p.present(e)),
  ...(p.finish?.() ?? []),
]

/**
 * The contract `@theokit/gateway` declares for `sendMessage`, copied here rather than imported.
 *
 * Importing it would make `@theokit/presenter` depend on a gateway package from another
 * repository, and `dependencies: {}` is the property `ChatPresenter` was built to preserve —
 * a gateway must stay usable without an agent, so the dependency may only point one way.
 *
 * TypeScript is structural, so a copy is enough to PROVE compatibility. What a copy cannot do is
 * notice that the original moved: if `OutboundMessage` gains a required field, this file keeps
 * passing and the real integration breaks. That risk is the price of `dependencies: {}` and it is
 * stated here rather than left for someone to discover — mirrored verbatim from
 * `@theokit/gateway`'s `adapter/base.ts` on 2026-09-17.
 */
interface OutboundMessageContract {
  readonly channel: {
    readonly id: string
    readonly type: 'dm' | 'group' | 'thread'
    readonly topicId?: string
  }
  readonly text: string
  readonly format?: 'plain' | 'markdown' | 'html'
  readonly replyTo?: string
}

describe('ChatPresenter', () => {
  it('emits something the gateway can send, without importing the gateway', () => {
    const out = run(
      new ChatPresenter({ channel: { id: 'c1', type: 'dm' }, replyTo: 'm7', format: 'plain' }),
      [{ type: 'text', text: 'ok' }, { type: 'finish' }],
    )

    // The assertion that matters is the assignment: it is checked by `tsc --noEmit`, which CI runs.
    // A `ChatMessage` that stops satisfying the gateway's shape fails the typecheck rather than
    // failing in production on the first real send.
    const sendable: OutboundMessageContract = out[0] as ChatMessage
    expect(sendable).toMatchObject({ text: 'ok', format: 'plain', replyTo: 'm7' })
  })

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
