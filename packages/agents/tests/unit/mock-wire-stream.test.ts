import { describe, expect, it } from 'vitest'

import {
  createMockOutputEvents,
  createMockWireStream,
  wireChunk,
} from '../../src/testing/mock-wire-stream.js'

/**
 * M85 — a test seam over the vocabulary production actually speaks.
 *
 * ## What was wrong with the one we had
 *
 * The entire published test surface was ONE function, `createMockAgentStream`, and it emitted
 * `run_started` / `text_delta` / `tool_call` — a snake_case vocabulary **no production path of this
 * framework consumes**. Our own terminal renderer switches over the kebab-case `WIRE_CHUNK_TYPES`,
 * and the presenter speaks a third one.
 *
 * A consumer adopting it would be testing against event names that do not exist in production: a
 * green test as evidence about nothing. Measured adoption: **one** caller in the whole target — its
 * own unit test — and **zero** in the only real product, which recorded the refusal in prose.
 *
 * We were not eating this food either.
 *
 * ## Why the builders validate
 *
 * A fixture is a claim about what production emits. `{ type: 'error', errorText: 'boom' } as never`
 * is a claim nothing checks — and the cast is the consumer telling you, in the code, that the seam
 * did not fit. Validating at CONSTRUCTION means a malformed fixture fails where it is written,
 * rather than passing a test that proves nothing.
 */

describe('wireChunk builders produce chunks the schema accepts', () => {
  it('test_a_text_chunk_is_valid', async () => {
    const { wireChunkSchema } = await import('@theokit/presenter/wire')
    expect(wireChunkSchema.safeParse(wireChunk.text('hello')).success).toBe(true)
  })

  it('test_an_error_chunk_is_valid_and_needs_no_cast', async () => {
    // The literal the consumer was writing by hand, with `as never` on the end. That cast was the
    // seam admitting it did not fit.
    const { wireChunkSchema } = await import('@theokit/presenter/wire')
    expect(wireChunkSchema.safeParse(wireChunk.error('boom')).success).toBe(true)
  })

  it('test_a_malformed_chunk_fails_AT_CONSTRUCTION', () => {
    // The whole reason the builders validate. A fixture that only fails when a renderer chokes on it
    // fails far from where it was written, and reads as a renderer bug.
    // @ts-expect-error — a number is not chunk text; the type refuses before the runtime does.
    expect(() => wireChunk.text(42)).toThrow()
  })

  it('test_every_builder_produces_a_type_in_WIRE_CHUNK_TYPES', async () => {
    // The anti-drift assertion: a builder emitting a type the parser does not know is exactly the
    // failure this milestone exists to end, one level down.
    const { WIRE_CHUNK_TYPES } = await import('@theokit/presenter/wire')
    const known = new Set<string>(WIRE_CHUNK_TYPES)
    for (const chunk of [wireChunk.text('a'), wireChunk.error('b'), wireChunk.finish()]) {
      expect(known, `${chunk.type} is not a known wire chunk type`).toContain(chunk.type)
    }
  })
})

describe('createMockWireStream speaks the wire, not a third vocabulary', () => {
  it('test_it_yields_the_chunks_it_was_given', async () => {
    const stream = createMockWireStream([wireChunk.text('hi'), wireChunk.finish()])
    const seen = []
    for await (const chunk of stream) seen.push(chunk)
    expect(seen.map((c) => c.type)).toEqual(['text-delta', 'finish'])
  })

  it('test_an_empty_stream_completes_rather_than_hanging', async () => {
    // A fixture with nothing in it is how a test for "the agent said nothing" is written. Hanging
    // there would make that test time out instead of pass.
    const seen = []
    for await (const chunk of createMockWireStream([])) seen.push(chunk)
    expect(seen).toEqual([])
  })
})

describe('createMockOutputEvents speaks the presenter vocabulary', () => {
  it('test_it_yields_output_events_directly', async () => {
    // The second vocabulary, published deliberately: a test of a presenter surface should not have
    // to round-trip through the wire to produce one event.
    const stream = createMockOutputEvents([{ type: 'text', text: 'hello' }])
    const seen = []
    for await (const event of stream) seen.push(event)
    expect(seen).toEqual([{ type: 'text', text: 'hello' }])
  })
})

describe('the acceptance criterion — no cast anywhere in this file', () => {
  it('test_a_wire_stream_converts_to_output_events_with_no_cast', async () => {
    // The mechanical criterion the DoD names, expressed where it can be checked: this whole file
    // contains one `@ts-expect-error` (which asserts a REFUSAL) and no `as`. If the seam needed a
    // cast to be usable, it would appear here.
    const { fromWireChunk } = await import('@theokit/presenter')
    const events = []
    for await (const chunk of createMockWireStream([wireChunk.text('hi')])) {
      events.push(...fromWireChunk(chunk))
    }
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('text')
  })
})

describe('inspectCompiled — the assertion with the widest blast radius', () => {
  it('test_it_reports_the_tool_names_the_model_will_see', async () => {
    // The consumer documented that THIS, and not the stream, is what matters in an agent product: a
    // wrong answer here is a tool the model cannot see while the operator believes it can.
    // No `.catch(() => undefined)` escape here: a guard that lets the test return early makes it a
    // no-op that reports green, which is the exact failure this milestone is about.
    const { inspectCompiled } = await import('../../src/testing/inspect-compiled.js')
    const { defineAgent } = await import('../../src/bridge/define-agent.js')

    const agent = defineAgent({ model: 'gpt-5', tools: [] })
    expect(inspectCompiled(agent).model).toBe('gpt-5')
  })

  it('test_an_agent_with_no_tools_reports_an_EMPTY_list_not_undefined', async () => {
    // A caller writing `inspect.toolNames.includes('x')` must never have to narrow. `undefined` here
    // is how a test for "this agent has no tools" turns into a TypeError.
    const { inspectCompiled } = await import('../../src/testing/inspect-compiled.js')
    const { defineAgent } = await import('../../src/bridge/define-agent.js')
    const inspection = inspectCompiled(defineAgent({ model: 'gpt-5', tools: [] }))
    expect(inspection.toolNames).toEqual([])
    expect(inspection.gatedToolNames).toEqual([])
  })

  it('test_it_READS_the_real_compiler_rather_than_re_deriving', async () => {
    // The property that keeps it honest: a compilation change must surface HERE, not in a fixture
    // that agreed with an older version of the truth.
    const inspectSource = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../../src/testing/inspect-compiled.ts', import.meta.url), 'utf8'),
    )
    expect(inspectSource).toContain('compileAgentDefinition')
  })
})
