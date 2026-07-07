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
