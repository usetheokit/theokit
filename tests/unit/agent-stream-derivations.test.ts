import { describe, expect, it } from 'vitest'

import {
  defaultResolveEnvelope,
  foldAgentToolCards,
} from '../../packages/theo/src/client/agent-tool-cards.js'
import { deriveError, deriveLiveText } from '../../packages/theo/src/client/use-agent-stream.js'
import { parseSSEChunk } from '../../packages/theo/src/client/agent-stream-core.js'
import type { AgentEvent } from '../../packages/theo/src/core/contracts/agent-events.js'

describe('deriveLiveText (M5-1)', () => {
  it('concatenates all message contents', () => {
    const events: AgentEvent[] = [
      { type: 'message', content: 'a' },
      { type: 'tool_call', name: 'x', args: {} },
      { type: 'message', content: 'b' },
    ]
    expect(deriveLiveText(events)).toBe('ab')
  })

  it('is empty without message events', () => {
    expect(deriveLiveText([{ type: 'tool_call', name: 'x', args: {} }])).toBe('')
  })
})

describe('deriveError (M5-1)', () => {
  it('returns the last error event (with code)', () => {
    const events: AgentEvent[] = [
      { type: 'message', content: 'a' },
      { type: 'error', message: 'boom', code: 'rate_limit' },
    ]
    expect(deriveError(events)).toEqual({ type: 'error', message: 'boom', code: 'rate_limit' })
  })

  it('returns undefined when there is no error', () => {
    expect(deriveError([{ type: 'message', content: 'a' }])).toBeUndefined()
  })

  it('returns the LAST error when several occur (retry replaces the prior error)', () => {
    const events: AgentEvent[] = [
      { type: 'error', message: 'rate limited', code: 'rate_limit' },
      { type: 'message', content: 'retrying' },
      { type: 'error', message: 'unauthorized', code: 'auth' },
    ]
    expect(deriveError(events)).toEqual({ type: 'error', message: 'unauthorized', code: 'auth' })
  })

  it('is empty over zero events', () => {
    expect(deriveLiveText([])).toBe('')
    expect(deriveError([])).toBeUndefined()
  })
})

describe('defaultResolveEnvelope (M5-2, EC-1)', () => {
  it('flags an object {ok:false} as error', () => {
    expect(defaultResolveEnvelope({ ok: false }).error).toBe(true)
    expect(defaultResolveEnvelope({ ok: true }).error).toBe(false)
  })
  it('parses a JSON-string envelope (sdk-tools return strings)', () => {
    expect(defaultResolveEnvelope('{"ok":false,"error":"not_found"}').error).toBe(true)
    expect(defaultResolveEnvelope('{"ok":true}').error).toBe(false)
  })
  it('treats a non-JSON string / plain value as success (conservative)', () => {
    expect(defaultResolveEnvelope('hello').error).toBe(false)
    expect(defaultResolveEnvelope(42).error).toBe(false)
  })
})

describe('foldAgentToolCards (M5-2)', () => {
  it('correlates call→result by id into one success card', () => {
    const events: AgentEvent[] = [
      { type: 'tool_call', name: 'read', args: { path: 'a' }, id: '1' },
      { type: 'tool_result', name: 'read', data: { ok: true }, id: '1' },
    ]
    expect(foldAgentToolCards(events)).toEqual([
      { id: '1', name: 'read', args: { path: 'a' }, status: 'success', result: { ok: true } },
    ])
  })

  it('marks error via the envelope resolver (json string)', () => {
    const events: AgentEvent[] = [
      { type: 'tool_call', name: 'read', args: {}, id: '1' },
      { type: 'tool_result', name: 'read', data: '{"ok":false}', id: '1' },
    ]
    expect(foldAgentToolCards(events)[0]?.status).toBe('error')
  })

  it('is running when there is no result', () => {
    const cards = foldAgentToolCards([{ type: 'tool_call', name: 'read', args: {}, id: '1' }])
    expect(cards[0]?.status).toBe('running')
    expect(cards[0]?.result).toBeUndefined()
  })

  it('matches two concurrent same-name id-less calls in FIFO order', () => {
    const events: AgentEvent[] = [
      { type: 'tool_call', name: 'read', args: { path: 'A' } },
      { type: 'tool_call', name: 'read', args: { path: 'B' } },
      { type: 'tool_result', name: 'read', data: 'first' },
      { type: 'tool_result', name: 'read', data: 'second' },
    ]
    const cards = foldAgentToolCards(events)
    expect(cards).toHaveLength(2)
    // oldest call (path A) pairs with the first result
    expect(cards[0]?.args).toEqual({ path: 'A' })
    expect(cards[0]?.result).toBe('first')
    expect(cards[1]?.args).toEqual({ path: 'B' })
    expect(cards[1]?.result).toBe('second')
  })

  it('correlates results that arrive out of order by id', () => {
    const events: AgentEvent[] = [
      { type: 'tool_call', name: 'read', args: { path: 'A' }, id: '1' },
      { type: 'tool_call', name: 'read', args: { path: 'B' }, id: '2' },
      { type: 'tool_result', name: 'read', data: 'for-2', id: '2' },
      { type: 'tool_result', name: 'read', data: 'for-1', id: '1' },
    ]
    const cards = foldAgentToolCards(events)
    expect(cards.find((c) => c.id === '1')?.result).toBe('for-1')
    expect(cards.find((c) => c.id === '2')?.result).toBe('for-2')
    expect(cards).toHaveLength(2)
  })

  it('(M1) correlates when the call carries an id but the result omits it', () => {
    const events: AgentEvent[] = [
      { type: 'tool_call', name: 'read', args: { path: 'A' }, id: '1' },
      { type: 'tool_result', name: 'read', data: { ok: true } },
    ]
    const cards = foldAgentToolCards(events)
    expect(cards).toHaveLength(1)
    expect(cards[0]).toEqual({
      id: '1',
      name: 'read',
      args: { path: 'A' },
      status: 'success',
      result: { ok: true },
    })
  })

  it('(M1) correlates when the call omits the id but the result carries it', () => {
    const events: AgentEvent[] = [
      { type: 'tool_call', name: 'read', args: { path: 'A' } },
      { type: 'tool_result', name: 'read', data: { ok: true }, id: '1' },
    ]
    const cards = foldAgentToolCards(events)
    expect(cards).toHaveLength(1)
    expect(cards[0]?.args).toEqual({ path: 'A' })
    expect(cards[0]?.status).toBe('success')
  })

  it('leaves an unresolved call running while a sibling call resolves', () => {
    const events: AgentEvent[] = [
      { type: 'tool_call', name: 'read', args: { path: 'A' }, id: '1' },
      { type: 'tool_call', name: 'write', args: { path: 'B' }, id: '2' },
      { type: 'tool_result', name: 'write', data: { ok: true }, id: '2' },
    ]
    const cards = foldAgentToolCards(events)
    expect(cards.find((c) => c.id === '1')?.status).toBe('running')
    expect(cards.find((c) => c.id === '2')?.status).toBe('success')
  })

  it('correlates by name FIFO when id is absent', () => {
    const events: AgentEvent[] = [
      { type: 'tool_call', name: 'read', args: {} },
      { type: 'tool_result', name: 'read', data: { ok: true } },
    ]
    const cards = foldAgentToolCards(events)
    expect(cards).toHaveLength(1)
    expect(cards[0]?.status).toBe('success')
  })

  it('(EC-2) an orphan tool_result still becomes a finished card', () => {
    const cards = foldAgentToolCards([
      { type: 'tool_result', name: 'read', data: { ok: true }, id: '9' },
    ])
    expect(cards).toEqual([
      { id: '9', name: 'read', args: {}, status: 'success', result: { ok: true } },
    ])
  })

  it('empty events → []', () => {
    expect(foldAgentToolCards([])).toEqual([])
  })

  it('injectable resolver overrides the default', () => {
    const events: AgentEvent[] = [
      { type: 'tool_call', name: 'read', args: {}, id: '1' },
      { type: 'tool_result', name: 'read', data: { ok: true }, id: '1' },
    ]
    const cards = foldAgentToolCards(events, { resolveEnvelope: () => ({ error: true }) })
    expect(cards[0]?.status).toBe('error')
  })
})

describe('AgentThinkingEvent additivity (agents-thinking-event-contract)', () => {
  it('parseSSEChunk round-trips a thinking SSE line into the typed shape', () => {
    const ev = parseSSEChunk('data: {"type":"thinking","content":"I will list the files"}')
    expect(ev).toEqual({ type: 'thinking', content: 'I will list the files' })
  })

  it('deriveLiveText IGNORES thinking (reasoning never leaks into assistant text)', () => {
    const events: AgentEvent[] = [
      { type: 'message', content: 'Hi' },
      { type: 'thinking', content: 'internal reasoning that must not render as text' },
      { type: 'message', content: '!' },
    ]
    expect(deriveLiveText(events)).toBe('Hi!')
  })

  it('foldAgentToolCards IGNORES thinking (no spurious card)', () => {
    const events: AgentEvent[] = [
      { type: 'thinking', content: 'deciding to read' },
      { type: 'tool_call', name: 'read', args: { path: 'a' }, id: '1' },
      { type: 'tool_result', name: 'read', data: { ok: true }, id: '1' },
    ]
    const cards = foldAgentToolCards(events)
    expect(cards).toHaveLength(1)
    expect(cards[0]?.status).toBe('success')
  })

  it('deriveLiveText over a thinking-only stream is empty', () => {
    expect(deriveLiveText([{ type: 'thinking', content: 'reason' }])).toBe('')
  })
})

describe('theokit/client barrel (M5-1/M5-2 wiring)', () => {
  it('exposes the derivations + tool-card correlator through the public barrel', async () => {
    const mod = await import('theokit/client')
    expect(typeof mod.deriveLiveText).toBe('function')
    expect(typeof mod.deriveError).toBe('function')
    expect(typeof mod.foldAgentToolCards).toBe('function')
    expect(typeof mod.defaultResolveEnvelope).toBe('function')
    expect(typeof mod.useAgentToolCards).toBe('function')
  })
})
