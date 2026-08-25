/**
 * M18 (theokit-ai-first) — tool output shaping: `toModelOutput` + `transform`.
 *
 * A tool's handler can return RICH data for the app while the model sees a smaller string
 * (`toModelOutput`), and the same rich result can be formatted differently for `display` vs
 * `transcript` targets (`transform`). Backward-compatible: a handler that returns a string with
 * no `toModelOutput` behaves exactly as before.
 *
 * TDD RED-first.
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  applyTransform,
  defineAgentTool,
} from '../../packages/theo/src/server/define/define-agent-tool.js'

describe('usetheokit/theokit#464 — a handler that returns an object', () => {
  // It threw: "handler returned a non-string; provide toModelOutput to map it to a string". The
  // message was good and the moment was the worst available — the first time the MODEL calls the
  // tool, inside an agent run, with a provider key and tokens already spent. Returning an object is
  // the natural shape (`{ id, status, note }` serves a model better than a hand-concatenated
  // string), so it was the common path, not an edge.
  //
  // The fix is the default rather than the type. Every consumer's correction was the same single
  // line — `.toModelOutput((r) => JSON.stringify(r))` — and a default that every caller overrides
  // the same way is a default on the wrong side. `toModelOutput` still wins when the shape matters.
  it('serializes a JSON-serializable result instead of refusing it', async () => {
    const tool = defineAgentTool({
      name: 'lookup',
      description: 'returns a record',
      inputSchema: z.object({ id: z.string() }),
      handler: ({ id }) => ({ id, ok: true }),
    })

    expect(await tool.handler({ id: 'x' })).toBe('{"id":"x","ok":true}')
  })

  it('still prefers toModelOutput when one is given', async () => {
    const tool = defineAgentTool({
      name: 'lookup',
      description: 'returns a record',
      inputSchema: z.object({ id: z.string() }),
      handler: ({ id }) => ({ id, ok: true }),
      toModelOutput: (r) => `found ${r.id}`,
    })

    expect(await tool.handler({ id: 'x' })).toBe('found x')
  })

  // The explicit error survives for exactly the results no default can serialize, and it now says
  // what actually happened — asking for a `toModelOutput` would not have rescued a cycle.
  it('refuses a circular result, naming the reason', async () => {
    const circular: Record<string, unknown> = { name: 'loop' }
    circular.self = circular
    const tool = defineAgentTool({
      name: 'cyclic',
      description: 'returns a cycle',
      inputSchema: z.object({}),
      handler: () => circular,
    })

    await expect(tool.handler({})).rejects.toThrow(/cyclic/)
    await expect(tool.handler({})).rejects.toThrow(/could not be serialized/i)
  })

  it('refuses a result JSON cannot represent at all', async () => {
    const tool = defineAgentTool({
      name: 'opaque',
      description: 'returns a function',
      inputSchema: z.object({}),
      handler: () => (() => 'nope') as unknown as Record<string, unknown>,
    })

    await expect(tool.handler({})).rejects.toThrow(/could not be serialized/i)
  })
})

describe('M18 — toModelOutput', () => {
  it('returns a string handler result unchanged when no toModelOutput (backward-compatible)', async () => {
    const tool = defineAgentTool({
      name: 'echo',
      description: 'echo',
      inputSchema: z.object({ msg: z.string() }),
      handler: ({ msg }) => `you said: ${msg}`,
    })
    expect(await tool.handler({ msg: 'hi' })).toBe('you said: hi')
  })

  it('maps a rich handler result to the model-visible string via toModelOutput', async () => {
    const tool = defineAgentTool({
      name: 'search',
      description: 'search',
      inputSchema: z.object({ q: z.string() }),
      // Rich result for the app...
      handler: ({ q }) => ({ query: q, hits: [{ id: 1 }, { id: 2 }], tookMs: 12 }),
      // ...small string for the model.
      toModelOutput: (r) => `${r.hits.length} results for "${r.query}"`,
    })
    expect(await tool.handler({ q: 'agents' })).toBe('2 results for "agents"')
  })
})

describe('M18 — transform (display / transcript)', () => {
  it('formats a rich result differently per target via applyTransform', () => {
    const tool = defineAgentTool({
      name: 'weather',
      description: 'weather',
      inputSchema: z.object({ city: z.string() }),
      handler: ({ city }) => ({ city, tempC: 21 }),
      toModelOutput: (r) => `${r.tempC}°C in ${r.city}`,
      transform: {
        display: (r) => ({ kind: 'weather-card', city: r.city, temp: `${r.tempC}°C` }),
        transcript: (r) => `Weather: ${r.city} ${r.tempC}°C`,
      },
    })
    const rich = { city: 'SP', tempC: 21 }
    expect(applyTransform(tool, rich, 'display')).toEqual({
      kind: 'weather-card',
      city: 'SP',
      temp: '21°C',
    })
    expect(applyTransform(tool, rich, 'transcript')).toBe('Weather: SP 21°C')
  })

  it('applyTransform falls back to the raw result when no transform for the target', () => {
    const tool = defineAgentTool({
      name: 'x',
      description: 'x',
      inputSchema: z.object({}),
      handler: () => 'plain',
    })
    expect(applyTransform(tool, 'plain', 'display')).toBe('plain')
  })
})
