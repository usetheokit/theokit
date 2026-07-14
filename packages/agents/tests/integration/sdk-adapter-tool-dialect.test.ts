/**
 * theocode#32 T2.1/T2.2 — `stripToolDialect` wiring: when opted in, `createSdkAgentStream` wraps the
 * merged event stream with the tool-dialect stripper, so a leaked Hermes `<function=…></tool_call>`
 * block the model streams via `onDelta` is removed from the visible text. Off by default ⇒ the leak
 * stays in text (backward-compat). Mirrors `sdk-adapter-think-tags.test.ts`.
 *
 * Also covers the transform-level guards directly (EC-1 non-string passthrough, EC-2 flush-on-error).
 */
import 'reflect-metadata'
import { describe, expect, it, beforeEach, vi } from 'vitest'

import type { StreamEvent } from '../../src/bridge/agent-sse-handler.js'
import { stripToolDialectStream } from '../../src/bridge/tool-dialect-stripper.js'

const h = vi.hoisted(() => ({ deltaText: '' }))

vi.mock('@theokit/sdk', () => ({
  InMemoryConversationStorage: class {
    getMessages = async () => []
    appendMessage = async () => {}
  },
  Agent: {
    getOrCreate: vi.fn(async () => ({
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

const LEAK = '<function=write_file><parameter=path>x</parameter></function></tool_call>'

@Agent({ name: 'td-on', route: '/td-on', model: 'm', stripToolDialect: true })
class StripAgent {
  @MainLoop({ strategy: 'simple-chat' })
  async run() {}
}

@Agent({ name: 'td-off', route: '/td-off', model: 'm' })
class PlainAgent {
  @MainLoop({ strategy: 'simple-chat' })
  async run() {}
}

@Agent({
  name: 'td-both',
  route: '/td-both',
  model: 'm',
  parseThinkTags: true,
  stripToolDialect: true,
})
class BothAgent {
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

const text = (events: StreamEvent[]) =>
  events
    .filter((e) => e.type === 'text_delta')
    .map((e) => e.content)
    .join('')

describe('theocode#32 stripToolDialect wiring', () => {
  beforeEach(() => {
    h.deltaText = `${LEAK}answer`
  })

  it('test_agent_config_stripToolDialect_compiles', () => {
    expect(compileAgent(walkAgentMetadata(StripAgent)).stripToolDialect).toBe(true)
    expect(compileAgent(walkAgentMetadata(PlainAgent)).stripToolDialect).toBeUndefined()
  })

  it('test_stream_strips_dialect_when_enabled', async () => {
    expect(text(await streamEvents(StripAgent))).toBe('answer') // leak removed from visible text
  })

  it('test_stream_no_strip_when_disabled', async () => {
    // backward-compat: the raw leak stays in the text stream (no transform applied).
    expect(text(await streamEvents(PlainAgent))).toContain('<function=')
    expect(text(await streamEvents(PlainAgent))).toContain('</tool_call>')
  })

  it('test_run_override_stripToolDialect_beats_compiled', async () => {
    // compiled false (PlainAgent) + per-run override true ⇒ stripping applies.
    expect(text(await streamEvents(PlainAgent, { stripToolDialect: true }))).toBe('answer')
  })

  it('test_strip_composes_with_parseThinkTags', async () => {
    h.deltaText = `<think>r</think>${LEAK}ans`
    const events = await streamEvents(BothAgent)
    const thinking = events.filter((e) => e.type === 'thinking').map((e) => e.content)
    expect(thinking).toContain('r') // think extraction still fires
    expect(text(events)).toBe('ans') // AND the leak is stripped
  })

  it('test_stream_strips_leak_spanning_two_text_deltas', async () => {
    // EC-4: one stripper instance per stream ⇒ cross-event state. Drive two text-deltas; the leak
    // straddles the boundary. The mock onDelta fires once, so simulate the split at the transform level.
    async function* twoDeltas(): AsyncGenerator<StreamEvent> {
      yield { type: 'text_delta', content: 'ans <function=w>' }
      yield { type: 'text_delta', content: '</tool_call> more' }
    }
    const out: StreamEvent[] = []
    for await (const e of stripToolDialectStream(twoDeltas())) out.push(e)
    expect(text(out)).toBe('ans  more')
  })

  it('test_strip_passes_non_string_text_delta_untouched', async () => {
    // EC-1: a text_delta whose content is non-string is yielded unchanged, never coerced.
    const weird = { type: 'text_delta', content: { not: 'a string' } } as unknown as StreamEvent
    async function* src(): AsyncGenerator<StreamEvent> {
      yield weird
      yield { type: 'done' } as unknown as StreamEvent
    }
    const out: StreamEvent[] = []
    for await (const e of stripToolDialectStream(src())) out.push(e)
    expect(out[0]).toBe(weird) // same reference, untouched
    expect(out[1]).toEqual({ type: 'done' })
  })

  it('test_strip_flushes_buffer_when_source_errors_midstream', async () => {
    // EC-2/Rule 8: a partial '<function=…' then an error ⇒ buffered tail flushed as text before the
    // error re-propagates (finally), never silently dropped.
    async function* boom(): AsyncGenerator<StreamEvent> {
      yield { type: 'text_delta', content: 'x<function=w>partial' }
      throw new Error('stream broke')
    }
    const out: StreamEvent[] = []
    await expect(async () => {
      for await (const e of stripToolDialectStream(boom())) out.push(e)
    }).rejects.toThrow('stream broke')
    // the unclosed leak was flushed losslessly as text before the throw surfaced
    expect(text(out)).toBe('x<function=w>partial')
  })
})
