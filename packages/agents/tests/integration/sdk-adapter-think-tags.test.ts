/**
 * M2 T3.1 — `parseThinkTags` wiring: when opted in, `createSdkAgentStream` wraps the merged event
 * stream with the `<think>`-tag extractor, so inline `<think>…</think>` text the model streams via
 * `onDelta` surfaces as `thinking` StreamEvents. Off by default ⇒ the `<think>` stays in text.
 *
 * Reuses the `@theokit/sdk` capture-mock pattern from `sdk-adapter-reasoning.test.ts`; the fake
 * `send` drives `onDelta` with a `text-delta` (the adapter's real token-stream path, #44).
 */
import 'reflect-metadata'
import { describe, expect, it, beforeEach, vi } from 'vitest'

import type { StreamEvent } from '../../src/bridge/agent-sse-handler.js'

const h = vi.hoisted(() => ({ deltaText: '' }))

vi.mock('@theokit/sdk', () => ({
  InMemoryConversationStorage: class {
    getMessages = async () => []
    appendMessage = async () => {}
  },
  Agent: {
    getOrCreate: vi.fn(async () => ({
      // Drive onDelta with the configured text (the adapter's #44 token-stream path), then FINISH.
      send: async (_msg: string, opts?: { onDelta?: (d: { update: unknown }) => void }) => {
        opts?.onDelta?.({ update: { type: 'text-delta', text: h.deltaText } })
        return {
          stream: async function* () {
            yield { type: 'status', status: 'FINISHED' }
          },
          wait: async () => ({}),
        }
      },
      dispose: async () => {},
    })),
  },
  Tool: { create: (s: unknown) => s },
}))

const { AgentRunner } = await import('../../src/index.js')
const { compileAgent } = await import('../../src/bridge/agent-compiler.js')
const { walkAgentMetadata } = await import('../../src/bridge/walk-agent-metadata.js')
const { Agent } = await import('../../src/decorators/agent.js')
const { MainLoop } = await import('../../src/decorators/main-loop.js')

@Agent({ name: 'tt-on', route: '/tt-on', model: 'm', parseThinkTags: true })
class ThinkTagsAgent {
  @MainLoop({ strategy: 'simple-chat' })
  async run() {}
}

@Agent({ name: 'tt-off', route: '/tt-off', model: 'm' })
class PlainAgent {
  @MainLoop({ strategy: 'simple-chat' })
  async run() {}
}

async function streamEvents(AgentClass: Parameters<typeof AgentRunner.builder>[0], opts = {}) {
  const gen = AgentRunner.builder(AgentClass)
    .build()
    .stream('hi', { apiKey: 'k', ...opts })
  const events: StreamEvent[] = []
  for await (const e of gen) events.push(e as StreamEvent)
  return events
}

describe('M2 parseThinkTags wiring', () => {
  beforeEach(() => {
    h.deltaText = '<think>reasoning</think>answer'
  })

  it('test_agent_config_parseThinkTags_compiles', () => {
    expect(compileAgent(walkAgentMetadata(ThinkTagsAgent)).parseThinkTags).toBe(true)
    expect(compileAgent(walkAgentMetadata(PlainAgent)).parseThinkTags).toBeUndefined()
  })

  it('test_stream_extracts_think_when_enabled', async () => {
    const events = await streamEvents(ThinkTagsAgent)
    const thinking = events.filter((e) => e.type === 'thinking').map((e) => e.content)
    const text = events.filter((e) => e.type === 'text_delta').map((e) => e.content)
    expect(thinking).toContain('reasoning')
    expect(text.join('')).toBe('answer') // <think> block removed from the visible text
  })

  it('test_stream_no_extract_when_disabled', async () => {
    const events = await streamEvents(PlainAgent)
    expect(events.some((e) => e.type === 'thinking')).toBe(false)
    // The raw <think> stays in the text stream (backward-compat — no transform applied).
    const text = events
      .filter((e) => e.type === 'text_delta')
      .map((e) => e.content)
      .join('')
    expect(text).toContain('<think>reasoning</think>answer')
  })

  it('test_run_override_parseThinkTags_beats_compiled', async () => {
    // compiled false (PlainAgent) + per-run override true ⇒ extraction applies.
    const events = await streamEvents(PlainAgent, { parseThinkTags: true })
    expect(events.some((e) => e.type === 'thinking' && e.content === 'reasoning')).toBe(true)
  })
})
