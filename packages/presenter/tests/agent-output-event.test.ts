import { describe, expect, it } from 'vitest'

import {
  AGENT_OUTPUT_EVENT_TYPES,
  type AgentOutputEvent,
  isErrorEvent,
  isFinishEvent,
  isReasoningEvent,
  isStatusEvent,
  isTextEvent,
  isToolCallEvent,
  isToolResultEvent,
} from '../src/agent-output-event.js'

// M49 T0.2 — the canonical event is the narrow waist. Each variant must construct + discriminate cleanly.
describe('AgentOutputEvent (M49 — canonical narrow-waist event)', () => {
  it('exposes exactly the 7 variant discriminants', () => {
    expect([...AGENT_OUTPUT_EVENT_TYPES]).toEqual([
      'text',
      'reasoning',
      'tool-call',
      'tool-result',
      'error',
      'finish',
      'status',
    ])
  })

  it('each type-guard discriminates its own variant and rejects the others', () => {
    const events: Record<string, AgentOutputEvent> = {
      text: { type: 'text', text: 'hi' },
      reasoning: { type: 'reasoning', text: 'thinking' },
      'tool-call': { type: 'tool-call', callId: 'c1', name: 'grep', input: { q: 'x' } },
      'tool-result': { type: 'tool-result', callId: 'c1', name: 'grep', result: 'ok' },
      error: { type: 'error', message: 'boom', code: 'E_X' },
      finish: { type: 'finish', reason: 'stop', usage: { totalTokens: 42 } },
      status: { type: 'status', status: 'completed', detail: 'goal done' },
    }
    const guards = {
      text: isTextEvent,
      reasoning: isReasoningEvent,
      'tool-call': isToolCallEvent,
      'tool-result': isToolResultEvent,
      error: isErrorEvent,
      finish: isFinishEvent,
      status: isStatusEvent,
    } as const

    for (const key of AGENT_OUTPUT_EVENT_TYPES) {
      // the matching guard accepts its own variant...
      expect(guards[key](events[key])).toBe(true)
      // ...and rejects every OTHER variant (no overlap)
      for (const other of AGENT_OUTPUT_EVENT_TYPES) {
        if (other !== key) expect(guards[key](events[other])).toBe(false)
      }
    }
  })

  it('narrows the payload through the guard (tool-call carries callId/name/input)', () => {
    const e: AgentOutputEvent = {
      type: 'tool-call',
      callId: 'c9',
      name: 'edit',
      input: { path: 'a.ts' },
    }
    if (isToolCallEvent(e)) {
      expect(e.callId).toBe('c9')
      expect(e.name).toBe('edit')
      expect(e.input).toEqual({ path: 'a.ts' })
    } else {
      throw new Error('guard should have narrowed to tool-call')
    }
  })
})
