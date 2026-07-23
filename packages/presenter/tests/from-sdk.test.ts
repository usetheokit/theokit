import { describe, expect, it } from 'vitest'

import type { InteractionUpdate } from '@theokit/sdk'

import { fromInteractionUpdate, fromSdkMessage } from '../src/source/from-sdk.js'

// M49 T0.3 — the single SDK→canonical source translator. Each SDK discriminant maps to the right
// pure-output variant; framework-only messages produce nothing (ADR-4).
describe('fromSdkMessage (buffered run.stream path)', () => {
  it('assistant text block → text event', () => {
    const out = fromSdkMessage({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'hi' }] },
    })
    expect(out).toEqual([{ type: 'text', text: 'hi' }])
  })

  it('assistant tool_use block → tool-call event', () => {
    const out = fromSdkMessage({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', id: 'c1', name: 'grep', input: { q: 'x' } }] },
    })
    expect(out).toEqual([{ type: 'tool-call', callId: 'c1', name: 'grep', input: { q: 'x' } }])
  })

  it('thinking → reasoning event', () => {
    expect(fromSdkMessage({ type: 'thinking', text: 'hmm' })).toEqual([
      { type: 'reasoning', text: 'hmm' },
    ])
  })

  it('tool_call running → tool-call (args); completed → tool-result; error → tool-result isError', () => {
    expect(
      fromSdkMessage({
        type: 'tool_call',
        status: 'running',
        call_id: 'c1',
        name: 'sh',
        args: { cmd: 'ls' },
      }),
    ).toEqual([{ type: 'tool-call', callId: 'c1', name: 'sh', input: { cmd: 'ls' } }])
    expect(
      fromSdkMessage({
        type: 'tool_call',
        status: 'completed',
        call_id: 'c1',
        name: 'sh',
        result: 'ok',
      }),
    ).toEqual([{ type: 'tool-result', callId: 'c1', name: 'sh', result: 'ok', isError: false }])
    expect(
      fromSdkMessage({
        type: 'tool_call',
        status: 'error',
        call_id: 'c1',
        name: 'sh',
        result: 'boom',
      }),
    ).toEqual([{ type: 'tool-result', callId: 'c1', name: 'sh', result: 'boom', isError: true }])
  })

  it('status FINISHED → finish; ERROR → error', () => {
    expect(fromSdkMessage({ type: 'status', status: 'FINISHED' })).toEqual([
      { type: 'finish', reason: 'finished' },
    ])
    expect(fromSdkMessage({ type: 'status', status: 'ERROR', message: 'bad' })).toEqual([
      { type: 'error', message: 'bad', code: 'AGENT_ERROR' },
    ])
  })

  it('serializes a non-string tool result to JSON (BigInt preserved, circular → fallback)', () => {
    expect(
      fromSdkMessage({
        type: 'tool_call',
        status: 'completed',
        call_id: 'c',
        name: 't',
        result: { a: 1 },
      }),
    ).toEqual([{ type: 'tool-result', callId: 'c', name: 't', result: '{"a":1}', isError: false }])
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(
      (
        fromSdkMessage({
          type: 'tool_call',
          status: 'completed',
          call_id: 'c',
          name: 't',
          result: circular,
        })[0] as { result: string }
      ).result,
    ).toBe('')
  })

  it('system / unknown messages produce no output (framework framing, not pure output)', () => {
    expect(fromSdkMessage({ type: 'system', agent_id: 'a', model: 'm' })).toEqual([])
    expect(fromSdkMessage({ type: 'iteration' })).toEqual([])
  })
})

describe('fromInteractionUpdate (chronological onDelta path)', () => {
  it('maps each streamed update to the right canonical variant', () => {
    expect(fromInteractionUpdate({ type: 'text-delta', text: 'a' } as InteractionUpdate)).toEqual([
      { type: 'text', text: 'a' },
    ])
    expect(
      fromInteractionUpdate({ type: 'thinking-delta', text: 'b' } as InteractionUpdate),
    ).toEqual([{ type: 'reasoning', text: 'b' }])
    expect(
      fromInteractionUpdate({
        type: 'tool-call-started',
        callId: 'c1',
        toolCall: { name: 'sh', args: { cmd: 'ls' } },
      } as InteractionUpdate),
    ).toEqual([{ type: 'tool-call', callId: 'c1', name: 'sh', input: { cmd: 'ls' } }])
    expect(
      fromInteractionUpdate({
        type: 'partial-tool-call',
        callId: 'c1',
        toolCall: { name: 'sh', args: { cmd: 'l' } },
      } as InteractionUpdate),
    ).toEqual([{ type: 'partial-tool-call', callId: 'c1', name: 'sh', input: { cmd: 'l' } }])
    expect(
      fromInteractionUpdate({
        type: 'tool-call-completed',
        callId: 'c1',
        toolCall: { name: 'sh', result: 'done' },
      } as InteractionUpdate),
    ).toEqual([{ type: 'tool-result', callId: 'c1', name: 'sh', result: 'done', isError: false }])
  })

  it('non-output updates (token-delta, step-*) produce nothing', () => {
    expect(fromInteractionUpdate({ type: 'token-delta' } as unknown as InteractionUpdate)).toEqual(
      [],
    )
  })
})
