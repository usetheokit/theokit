import { describe, expect, it } from 'vitest'

import type { AgentOutputEvent } from '../src/agent-output-event.js'
import { fromWireChunk } from '../src/source/from-wire-chunk.js'
import { WIRE_CHUNK_TYPES, type WireChunk } from '../src/wire/chunk-schema.js'

/**
 * M70 — `fromWireChunk`: the door from the wire into the canonical event.
 *
 * ## The gap this closes
 *
 * The presenter normalises agent output into `AgentOutputEvent` and ships three presenters plus a
 * registry. Its only source translators consumed RAW `@theokit/sdk` messages — but every embedded
 * consumer drives a transport, which produces `WireChunk`, already translated. There was no
 * `WireChunk → AgentOutputEvent` door, so the surface that actually receives the stream never
 * entered the canonical event.
 *
 * That is the mechanical explanation for the presenter having one import site in the measured
 * consumer and none in its TUI. And it is structural, not an idiosyncrasy: OUR OWN
 * `render-terminal.ts` switched on wire chunks by hand and never touched `TerminalPresenter`.
 *
 * ## The top risk, and the test that mitigates it
 *
 * The inverse mapping can lose information — a chunk with no canonical counterpart. The mitigation
 * named in the milestone is this file: the function returns `AgentOutputEvent[]` (0..n), and the
 * test below enumerates every member of `WIRE_CHUNK_TYPES`, failing on one nobody mapped. A
 * translator that silently drops a frame is the failure mode; a list that goes stale is how it
 * hides.
 */

/** One sample frame per fixed wire type — the enumeration the risk mitigation demands. */
const SAMPLES: Record<string, WireChunk> = {
  start: { type: 'start', messageId: 'm1' },
  'text-start': { type: 'text-start', id: 't1' },
  'text-delta': { type: 'text-delta', id: 't1', delta: 'hello' },
  'text-end': { type: 'text-end', id: 't1' },
  'reasoning-start': { type: 'reasoning-start', id: 'r1' },
  'reasoning-delta': { type: 'reasoning-delta', id: 'r1', delta: 'thinking' },
  'reasoning-end': { type: 'reasoning-end', id: 'r1' },
  'tool-input-available': {
    type: 'tool-input-available',
    toolCallId: 'c1',
    toolName: 'read_file',
    input: { path: 'a.ts' },
  },
  'tool-output-available': { type: 'tool-output-available', toolCallId: 'c1', output: 'contents' },
  'tool-output-error': { type: 'tool-output-error', toolCallId: 'c1', errorText: 'boom' },
  'tool-approval-request': { type: 'tool-approval-request', approvalId: 'a1', toolCallId: 'c1' },
  error: { type: 'error', errorText: 'provider failed' },
  finish: { type: 'finish' },
}

describe('fromWireChunk — every wire type is accounted for', () => {
  it('test_the_sample_set_covers_every_declared_wire_type', () => {
    // The mitigation's own precondition. If a variant is added upstream and mirrored into
    // WIRE_CHUNK_TYPES, this fails FIRST and says the sample list is stale — before the mapping
    // test below passes by simply never seeing the new frame.
    const byName = (a: string, b: string): number => a.localeCompare(b)
    expect([...WIRE_CHUNK_TYPES].sort(byName)).toEqual(Object.keys(SAMPLES).sort(byName))
  })

  it.each(WIRE_CHUNK_TYPES)('test_%s_maps_without_throwing', (type) => {
    const events = fromWireChunk(SAMPLES[type])
    expect(Array.isArray(events)).toBe(true)
  })

  it('test_a_data_part_is_accepted_and_produces_no_canonical_event', () => {
    // The `data-*` family is open by design and carries transport concerns, not agent output.
    expect(fromWireChunk({ type: 'data-error-code', data: { code: 'E' } })).toEqual([])
  })
})

describe('fromWireChunk — the mappings that carry payload', () => {
  const only = (chunk: WireChunk, names?: ReadonlyMap<string, string>): AgentOutputEvent => {
    const events = fromWireChunk(chunk, names)
    expect(events).toHaveLength(1)
    return events[0]
  }

  it('test_text_delta_becomes_a_text_event', () => {
    expect(only(SAMPLES['text-delta'])).toEqual({ type: 'text', text: 'hello' })
  })

  it('test_reasoning_delta_becomes_a_reasoning_event', () => {
    expect(only(SAMPLES['reasoning-delta'])).toEqual({ type: 'reasoning', text: 'thinking' })
  })

  it('test_tool_input_available_becomes_a_tool_call', () => {
    expect(only(SAMPLES['tool-input-available'])).toEqual({
      type: 'tool-call',
      callId: 'c1',
      name: 'read_file',
      input: { path: 'a.ts' },
    })
  })

  it('test_error_carries_its_message', () => {
    expect(only(SAMPLES.error)).toMatchObject({ type: 'error', message: 'provider failed' })
  })

  it('test_finish_becomes_a_finish_event', () => {
    expect(only(SAMPLES.finish)).toMatchObject({ type: 'finish' })
  })
})

describe('fromWireChunk — the name the wire does not carry', () => {
  // `tool-output-available` has `toolCallId` and `output` and NO `toolName`: the name appears only
  // on the earlier `tool-input-available`. That is why every consumer rendering tool results keeps
  // a callId→name map — including the one this function is replacing. The optional second argument
  // is where that state is threaded, rather than being invented here.
  const names = new Map([['c1', 'read_file']])

  it('test_tool_output_uses_the_supplied_name', () => {
    expect(fromWireChunk(SAMPLES['tool-output-available'], names)).toEqual([
      { type: 'tool-result', callId: 'c1', name: 'read_file', result: 'contents' },
    ])
  })

  it('test_tool_output_error_is_a_tool_result_marked_isError', () => {
    // Not an `error` event: a failed tool is still a tool result keyed by its call, and collapsing
    // it into a run-level error would lose which call failed.
    expect(fromWireChunk(SAMPLES['tool-output-error'], names)).toEqual([
      { type: 'tool-result', callId: 'c1', name: 'read_file', result: 'boom', isError: true },
    ])
  })

  it('test_without_the_map_the_result_still_maps_and_says_the_name_is_unknown', () => {
    // Degrading is right; inventing is not. Returning `[]` would drop a real result, and an empty
    // name would render as a blank line the operator cannot connect to anything.
    const [event] = fromWireChunk(SAMPLES['tool-output-available'])
    expect(event).toMatchObject({ type: 'tool-result', callId: 'c1', result: 'contents' })
    expect((event as { name: string }).name).toMatch(/unknown/i)
  })
})

describe('fromWireChunk — framing frames produce nothing', () => {
  it.each(['start', 'text-start', 'text-end', 'reasoning-start', 'reasoning-end'])(
    'test_%s_is_framing_and_yields_no_event',
    (type) => {
      // These delimit the stream; they are not agent output. Emitting a canonical event for them
      // would make every presenter render stream punctuation.
      expect(fromWireChunk(SAMPLES[type])).toEqual([])
    },
  )

  it('test_tool_approval_request_yields_no_canonical_event', () => {
    // HITL is a FRAMEWORK concern, not pure agent output — the same line ADR-4 drew when the
    // forward mapping composed approvals inline instead of routing them through the canonical
    // event. The inverse has to draw it in the same place or the two disagree.
    expect(fromWireChunk(SAMPLES['tool-approval-request'])).toEqual([])
  })
})
