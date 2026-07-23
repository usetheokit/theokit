import { describe, expect, it } from 'vitest'

import type { AgentOutputEvent } from '../src/agent-output-event.js'
import { PresenterRegistry } from '../src/presenter.js'
import { JsonPresenter } from '../src/presenters/json.js'
import { TerminalPresenter } from '../src/presenters/terminal.js'
import { UIMessageStreamPresenter } from '../src/presenters/ui-message-stream.js'

const EVENTS: AgentOutputEvent[] = [
  { type: 'reasoning', text: 'planning' },
  { type: 'text', text: 'running the tool' },
  { type: 'tool-call', callId: 'c1', name: 'sh', input: { cmd: 'ls -la' } },
  { type: 'tool-result', callId: 'c1', name: 'sh', result: 'a.ts b.ts' },
  { type: 'status', status: 'completed', detail: 'goal done' },
  { type: 'finish', reason: 'stop', usage: { totalTokens: 42 } },
]

describe('TerminalPresenter (M50 — terminal surface)', () => {
  it('maps each canonical variant to a semantic row (data, not a painted blob)', () => {
    const rows = EVENTS.flatMap((e) => new TerminalPresenter().present(e))
    expect(rows).toEqual([
      { kind: 'reasoning', text: '· planning' },
      { kind: 'text', text: 'running the tool' },
      { kind: 'tool', text: '⏺ sh({"cmd":"ls -la"})' },
      { kind: 'tool-result', text: '  ⎿ a.ts b.ts' },
      { kind: 'status', text: '● completed — goal done' },
      { kind: 'finish', text: '<< stop · 42 tokens >>' },
    ])
  })

  it('a failed tool renders as tool-error', () => {
    expect(
      new TerminalPresenter().present({
        type: 'tool-result',
        callId: 'c',
        name: 'sh',
        result: 'boom',
        isError: true,
      }),
    ).toEqual([{ kind: 'tool-error', text: '  ⎿ boom' }])
  })

  it('an error row carries the code when present', () => {
    expect(new TerminalPresenter().present({ type: 'error', message: 'bad', code: 'E_X' })).toEqual(
      [{ kind: 'error', text: '✖ bad (E_X)' }],
    )
  })

  it('ansi:true wraps the row (opt-in); default is plain data', () => {
    const [plain] = new TerminalPresenter().present({ type: 'text', text: 'hi' })
    const [colored] = new TerminalPresenter({ ansi: true }).present({
      type: 'reasoning',
      text: 'hi',
    })
    expect(plain.text).toBe('hi')
    expect(colored.text).toBe('\x1b[2m· hi\x1b[0m')
  })

  it('caps long previews and collapses whitespace', () => {
    const [row] = new TerminalPresenter({ maxPreview: 10 }).present({
      type: 'tool-result',
      callId: 'c',
      name: 't',
      result: 'a'.repeat(50),
    })
    expect(row.text).toBe(`  ⎿ ${'a'.repeat(9)}…`)
  })

  it('partial-tool-call and empty text produce no row', () => {
    const p = new TerminalPresenter()
    expect(p.present({ type: 'partial-tool-call', callId: 'c', name: 't', input: {} })).toEqual([])
    expect(p.present({ type: 'text', text: '' })).toEqual([])
  })
})

describe('JsonPresenter (M51 — API surface)', () => {
  it('namespaces the discriminant and passes the payload through verbatim', () => {
    expect(
      new JsonPresenter().present({
        type: 'tool-call',
        callId: 'c1',
        name: 'sh',
        input: { cmd: 'ls' },
      }),
    ).toEqual([{ type: 'agent.tool-call', callId: 'c1', name: 'sh', input: { cmd: 'ls' } }])
  })

  it('an empty namespace yields the bare canonical discriminant', () => {
    expect(new JsonPresenter({ namespace: '' }).present({ type: 'text', text: 'hi' })).toEqual([
      { type: 'text', text: 'hi' },
    ])
  })
})

describe('PresenterRegistry — one canonical stream drives every surface (M51 DoD)', () => {
  it('resolves all three surfaces and renders the SAME events through each', () => {
    const registry = new PresenterRegistry()
      .register(new TerminalPresenter())
      .register(new JsonPresenter())
      .register(new UIMessageStreamPresenter({ textId: 't' }))
    expect(registry.surfaces().sort()).toEqual(['json', 'terminal', 'ui-message-stream'])

    const term = registry.resolve<{ kind: string; text: string }>('terminal')
    const json = registry.resolve<{ type: string }>('json')
    const web = registry.resolve<{ type: string }>('ui-message-stream')

    // ONE canonical event → three surface outputs, no re-translation of the source.
    const e: AgentOutputEvent = { type: 'text', text: 'hello' }
    expect(term.present(e)).toEqual([{ kind: 'text', text: 'hello' }])
    expect(json.present(e)).toEqual([{ type: 'agent.text', text: 'hello' }])
    expect(web.present(e).map((c) => c.type)).toEqual(['text-start', 'text-delta'])
  })
})
