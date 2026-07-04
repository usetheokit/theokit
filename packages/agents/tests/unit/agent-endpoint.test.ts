/**
 * M2 (theokit-ai-first) — the file-convention runtime bridge (agent-endpoint).
 *
 * `compileAgentModule` converges both surfaces (ADR-B1): a `defineAgent` value and an
 * `@Agent + @MainLoop` class both lower to `CompiledAgentOptions`; a non-agent module
 * fails fast with a typed `AgentDefinitionError` naming the source. `streamAgentUIMessages`
 * wires `createSdkAgentStream` (SDK-mocked here — no LLM) through the M0/M1 translator, so
 * `agents/echo.ts` produces the exact `UIMessageStream` `useChat` consumes.
 */
import 'reflect-metadata'
import { describe, expect, it, vi } from 'vitest'

interface FakeStreamEvent {
  type: string
  [key: string]: unknown
}

const h = vi.hoisted(() => ({
  events: [] as FakeStreamEvent[],
  calls: [] as { apiKey: string; message: string; sessionId: string }[],
}))

vi.mock('../../src/bridge/sdk-adapter.js', () => ({
  createSdkAgentStream:
    (_compiled: unknown, _tools: unknown, apiKey: string) =>
    (message: string, sessionId: string): AsyncIterable<FakeStreamEvent> => {
      h.calls.push({ apiKey, message, sessionId })
      return (async function* () {
        for (const e of h.events) yield e
      })()
    },
}))

const { defineAgent } = await import('../../src/bridge/define-agent.js')
const { compileAgentModule, streamAgentUIMessages, AgentDefinitionError } =
  await import('../../src/bridge/agent-endpoint.js')
const { Agent } = await import('../../src/decorators/agent.js')
const { MainLoop } = await import('../../src/decorators/main-loop.js')

describe('compileAgentModule (M2)', () => {
  it('test_compiles_defineAgent_default_export', () => {
    const compiled = compileAgentModule({ default: defineAgent({ model: 'm', system: 's' }) })
    expect(compiled.model).toBe('m')
    expect(compiled.systemPrompt).toBe('s')
    expect(compiled.stream).toBe(true)
  })

  it('test_compiles_defineAgent_passed_directly', () => {
    expect(compileAgentModule(defineAgent({ model: 'm' })).model).toBe('m')
  })

  it('test_compiles_Agent_decorated_class', () => {
    @Agent({ model: 'deco-model' })
    class Support {
      @MainLoop({ strategy: 'simple-chat' })
      async run(): Promise<void> {}
    }
    const compiled = compileAgentModule({ default: Support })
    expect(compiled.model).toBe('deco-model')
    expect(compiled.tools).toEqual([])
  })

  it('test_throws_typed_error_naming_source_on_non_agent_module', () => {
    expect(() => compileAgentModule({ default: { hello: 1 } }, 'agents/bad.ts')).toThrow(
      AgentDefinitionError,
    )
    expect(() => compileAgentModule({ default: { hello: 1 } }, 'agents/bad.ts')).toThrow(
      /agents\/bad\.ts/,
    )
  })
})

describe('streamAgentUIMessages (M2)', () => {
  it('test_streams_uimessagestream_from_sdk_events', async () => {
    h.events = [
      { type: 'text_delta', content: 'hi' },
      {
        type: 'done',
        result: 'hi',
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        durationMs: 1,
      },
    ]
    h.calls = []
    const compiled = compileAgentModule(defineAgent({ model: 'm' }))

    const chunks: { type: string; [k: string]: unknown }[] = []
    for await (const c of streamAgentUIMessages(compiled, 'sk-test', {
      message: 'hi',
      sessionId: 's1',
    })) {
      chunks.push(c)
    }

    expect(chunks[0]).toEqual({ type: 'start' })
    expect(chunks.some((c) => c.type === 'text-delta' && c.delta === 'hi')).toBe(true)
    expect(chunks.at(-1)).toEqual({ type: 'finish' })
    // apiKey + message + sessionId threaded into the SDK runtime.
    expect(h.calls[0]).toEqual({ apiKey: 'sk-test', message: 'hi', sessionId: 's1' })
  })

  it('test_surfaces_sdk_error_event_as_error_chunk', async () => {
    h.events = [{ type: 'error', code: 'BOOM', message: 'kaboom', retryable: false }]
    h.calls = []
    const compiled = compileAgentModule(defineAgent({ model: 'm' }))

    const chunks: { type: string; [k: string]: unknown }[] = []
    for await (const c of streamAgentUIMessages(compiled, 'k', { message: 'x', sessionId: 's' })) {
      chunks.push(c)
    }
    expect(chunks.some((c) => c.type === 'error' && c.errorText === 'kaboom')).toBe(true)
    expect(chunks.at(-1)).toEqual({ type: 'finish' })
  })
})
