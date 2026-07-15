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
  overrides: [] as Record<string, unknown>[],
}))

vi.mock('../../src/bridge/sdk-adapter.js', () => ({
  createSdkAgentStream:
    (
      _compiled: unknown,
      _tools: unknown,
      apiKey: string,
      overrides: Record<string, unknown> = {},
    ) =>
    (message: string, sessionId: string): AsyncIterable<FakeStreamEvent> => {
      h.calls.push({ apiKey, message, sessionId })
      h.overrides.push(overrides)
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
const { Checkpoint } = await import('../../src/decorators/checkpoint.js')
const { Mixin } = await import('../../src/decorators/mixin.js')
const { Toolbox, Tool } = await import('../../src/decorators/tool.js')
const { HumanInTheLoop } = await import('../../src/decorators/human-in-the-loop.js')
const { z } = await import('zod')

const DONE: FakeStreamEvent = {
  type: 'done',
  result: 'hi',
  usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  durationMs: 1,
}

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

  it('test_gathers_mixin_toolboxes_and_gates_hitl_tool', () => {
    // The M2 file convention associates a class agent's tools via @Mixin (like app.ts). A gated
    // tool on the mixin must reach compiled.tools AND compiled.hitl so the endpoint pauses (M4).
    @Toolbox({ namespace: 'ops' })
    class OpsTools {
      @Tool({ name: 'deploy', description: 'Deploy', input: z.object({ env: z.string() }) })
      @HumanInTheLoop({ question: 'Deploy?' })
      async deploy(): Promise<string> {
        return 'ok'
      }
    }
    @Agent({ name: 'ops', route: '/ops' })
    @Mixin(OpsTools)
    class OpsAgent {
      @MainLoop({ strategy: 'simple-chat' })
      async run(): Promise<void> {}
    }

    const compiled = compileAgentModule({ default: OpsAgent })
    expect(compiled.tools.map((t) => t.name)).toContain('ops.deploy')
    expect(compiled.hitl?.get('ops.deploy')).toMatchObject({ question: 'Deploy?' })
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

async function collectStream(gen: AsyncIterable<{ type: string; [k: string]: unknown }>) {
  const chunks: { type: string; [k: string]: unknown }[] = []
  for await (const c of gen) chunks.push(c)
  return chunks
}

describe('streamAgentUIMessages — @Checkpoint emit + resume (M4)', () => {
  it('test_checkpoint_saved_emitted_when_checkpoint_declared', async () => {
    h.events = [{ type: 'text_delta', content: 'hi' }, DONE]
    h.calls = []
    h.overrides = []

    @Agent({ model: 'm' })
    @Checkpoint({ storage: 'filesystem' })
    class CheckpointedAgent {
      @MainLoop({ strategy: 'simple-chat' })
      async run(): Promise<void> {}
    }
    const compiled = compileAgentModule({ default: CheckpointedAgent })
    expect(compiled.checkpoint?.storage).toBe('filesystem')

    const chunks = await collectStream(
      streamAgentUIMessages(compiled, 'k', { message: 'hi', sessionId: 's1' }),
    )
    // The resume handle rides an ai-sdk-native transient `data-checkpoint` part, keyed by sessionId.
    const cp = chunks.find((c) => c.type === 'data-checkpoint')
    expect(cp).toBeDefined()
    expect((cp?.data as { resumeToken: string }).resumeToken).toBe('s1')
    expect(cp?.transient).toBe(true)
  })

  it('test_no_checkpoint_chunk_when_not_declared', async () => {
    h.events = [{ type: 'text_delta', content: 'hi' }, DONE]
    h.calls = []
    h.overrides = []
    const compiled = compileAgentModule(defineAgent({ model: 'm' })) // no @Checkpoint
    const chunks = await collectStream(
      streamAgentUIMessages(compiled, 'k', { message: 'hi', sessionId: 's1' }),
    )
    expect(chunks.some((c) => c.type === 'data-checkpoint')).toBe(false)
  })

  it('test_non_filesystem_checkpoint_emits_no_handle_and_warns', async () => {
    // G10 honesty (review HIGH-2): a 'memory' @Checkpoint cannot resume across requests, so it must
    // NOT emit a resume handle — and it warns at walk time so the no-op is never silent.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      h.events = [{ type: 'text_delta', content: 'hi' }, DONE]
      h.calls = []
      h.overrides = []

      @Agent({ model: 'm' })
      @Checkpoint({ storage: 'memory' })
      class MemAgent {
        @MainLoop({ strategy: 'simple-chat' })
        async run(): Promise<void> {}
      }
      const compiled = compileAgentModule({ default: MemAgent })
      const chunks = await collectStream(
        streamAgentUIMessages(compiled, 'k', { message: 'hi', sessionId: 's1' }),
      )
      expect(chunks.some((c) => c.type === 'data-checkpoint')).toBe(false)
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('THEO_AGENT_CHECKPOINT_STORAGE_METADATA_ONLY'),
      )
    } finally {
      warn.mockRestore()
    }
  })

  it('test_resume_by_sessionId_threads_the_session_into_the_sdk', async () => {
    // Resume is SDK-owned (SDK 4.0 native transcript): two requests with the SAME sessionId both reach
    // the SDK factory as `s1`, so prior turns re-hydrate. The harness's job is to thread the sessionId.
    h.events = [{ type: 'text_delta', content: 'a' }, DONE]
    h.calls = []
    h.overrides = []
    const compiled = compileAgentModule(defineAgent({ model: 'm' }))

    await collectStream(streamAgentUIMessages(compiled, 'k', { message: 'A', sessionId: 's1' }))
    await collectStream(streamAgentUIMessages(compiled, 'k', { message: 'B', sessionId: 's1' }))

    expect(h.calls.map((c) => c.sessionId)).toEqual(['s1', 's1'])
  })

  it('test_resume_by_sessionId_completes_cleanly', async () => {
    // A same-session request streams to a clean finish (no crash) — persistence is the SDK's native
    // transcript; theokit passes no storage adapter.
    h.events = [{ type: 'text_delta', content: 'a' }, DONE]
    h.calls = []
    h.overrides = []
    const compiled = compileAgentModule(defineAgent({ model: 'm' }))
    const chunks = await collectStream(
      streamAgentUIMessages(compiled, 'k', { message: 'A', sessionId: 's1' }),
    )
    expect(chunks.at(-1)).toEqual({ type: 'finish' })
  })
})
