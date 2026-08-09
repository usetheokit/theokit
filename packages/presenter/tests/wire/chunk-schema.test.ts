import { describe, expect, it } from 'vitest'

import { WIRE_CHUNK_TYPES, wireChunkSchema } from '../../src/wire/chunk-schema.js'

/**
 * T1.1 — the wire chunk union is the WRITE contract (plan D2, lado estrito).
 *
 * The variant set is measured, not guessed: 12 come from `UIMessageStreamPresenter`
 * (`src/presenters/ui-message-stream.ts`) and 5 from the agents bridge
 * (`tool-approval-request` + the `data-*` family). Anything the presenter can emit MUST parse here,
 * or we would ship a producer whose own output our reader rejects.
 */
describe('wireChunkSchema — the write contract', () => {
  const EMITTED_BY_PRESENTER = [
    { type: 'start' },
    { type: 'text-start', id: 't1' },
    { type: 'text-delta', id: 't1', delta: 'oi' },
    { type: 'text-end', id: 't1' },
    { type: 'reasoning-start', id: 'r1' },
    { type: 'reasoning-delta', id: 'r1', delta: 'pensando' },
    { type: 'reasoning-end', id: 'r1' },
    { type: 'tool-input-available', toolCallId: 'c1', toolName: 'shell', input: {}, dynamic: true },
    { type: 'tool-output-available', toolCallId: 'c1', output: 'ok' },
    { type: 'tool-output-error', toolCallId: 'c1', errorText: 'boom' },
    { type: 'error', errorText: 'falhou' },
    { type: 'finish' },
  ] as const

  it('test_the_schema_accepts_every_variant_the_presenter_emits', () => {
    for (const chunk of EMITTED_BY_PRESENTER) {
      const parsed = wireChunkSchema.safeParse(chunk)
      expect(
        parsed.success,
        `variante ${chunk.type} deveria parsear: ${JSON.stringify(chunk)}`,
      ).toBe(true)
    }
  })

  it('test_the_schema_accepts_the_frameworks_chunks', () => {
    const frameworkChunks = [
      { type: 'tool-approval-request', approvalId: 'a1', toolCallId: 'c1' },
      { type: 'data-checkpoint', data: { handle: 'h1' }, transient: true },
      { type: 'data-input-requested', data: { prompt: 'qual?' }, transient: true },
      { type: 'data-task-progress', data: { done: 1 }, transient: true },
      { type: 'data-shell-output', data: { stdout: 'x' }, transient: true },
    ]
    for (const chunk of frameworkChunks) {
      expect(wireChunkSchema.safeParse(chunk).success, `variante ${chunk.type}`).toBe(true)
    }
  })

  it('test_the_schema_rejects_an_unknown_variant', () => {
    expect(wireChunkSchema.safeParse({ type: 'inexistente' }).success).toBe(false)
  })

  it('test_finish_accepts_an_optional_messageMetadata', () => {
    // theokit#141 — a per-turn usage rides `messageMetadata` on the finish chunk.
    const withMeta = {
      type: 'finish',
      messageMetadata: { usage: { inputTokens: 10, outputTokens: 4 }, durationMs: 120 },
    }
    expect(wireChunkSchema.safeParse(withMeta).success).toBe(true)
  })

  it('test_extra_fields_from_a_provider_do_not_break_the_parse', () => {
    // A real frame carries optional fields we do not model (providerMetadata, title...). Rejecting
    // them would make our reader stricter than the wire it claims to speak.
    const rich = {
      type: 'tool-input-available',
      toolCallId: 'c1',
      toolName: 'shell',
      input: {},
      dynamic: true,
      providerMetadata: { anthropic: { cacheControl: 'ephemeral' } },
      title: 'Run shell',
    }
    expect(wireChunkSchema.safeParse(rich).success).toBe(true)
  })

  it('test_WIRE_CHUNK_TYPES_lists_every_variant_of_the_schema', () => {
    // The exported list is what `check-wire-parity.mjs` diffs against the `ai` union. If it drifts
    // from the schema, the parity gate compares the wrong set and its verdict means nothing.
    for (const chunk of EMITTED_BY_PRESENTER) {
      expect(WIRE_CHUNK_TYPES).toContain(chunk.type)
    }
    expect(WIRE_CHUNK_TYPES).toContain('tool-approval-request')
  })
})
