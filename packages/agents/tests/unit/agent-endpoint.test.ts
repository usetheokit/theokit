/**
 * M2 (theokit-ai-first) — the file-convention runtime bridge (agent-endpoint).
 *
 * `compileAgentModule` converges both surfaces (ADR-B1): a `defineAgent` value and an
 * `@Agent + @MainLoop` class both lower to `CompiledAgentOptions`; a non-agent module
 * fails fast with a typed `AgentDefinitionError` naming the source. `streamAgentUIMessages`
 * wires `createSdkAgentStream` (SDK-mocked here — no LLM) through the M0/M1 translator, so
 * `agents/echo.ts` produces the exact `UIMessageStream` `useChat` consumes.
 */
import { describe, expect, it, vi } from 'vitest'
import { ModelCapability } from '../../src/capability/capabilities.js'
import { CheckpointCapability } from '../../src/capability/agent-capabilities.js'
import { applyCapabilities } from '../../src/capability/capability.js'
import { ToolboxCapability, type ToolDeclaration } from '../../src/capability/toolbox.js'
import type { WireChunk, WireDataPart } from '@theokit/presenter/wire'

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
const { z } = await import('zod')

const DONE: FakeStreamEvent = {
  type: 'done',
  result: 'hi',
  usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  durationMs: 1,
}

/** The finish chunk a `DONE`-terminated run now carries — the translator attaches the turn's usage. */
const FINISH_DONE = {
  type: 'finish',
  messageMetadata: { usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, durationMs: 1 },
} as const

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

  it('test_compiles_capability_built_options', () => {
    // M53 — the decorated-class branch is gone; a module may default-export the compiled waist.
    const compiled = compileAgentModule({
      default: applyCapabilities([new ModelCapability('capability-model')]),
    })
    expect(compiled.model).toBe('capability-model')
    expect(compiled.tools).toEqual([])
  })

  it('test_throws_typed_error_naming_source_on_non_agent_module', () => {
    // Deliberately not an agent module. The cast is the point of the test: a JS consumer, or a
    // module arriving from a dynamic `import()` typed `any`, reaches the runtime with no type in
    // the way — so the guard must still refuse it (usetheokit/theokit#663).
    const NOT_AN_AGENT = { default: { hello: 1 } } as unknown as Parameters<
      typeof compileAgentModule
    >[0]
    expect(() => compileAgentModule(NOT_AN_AGENT, 'agents/bad.ts')).toThrow(AgentDefinitionError)
    expect(() => compileAgentModule(NOT_AN_AGENT, 'agents/bad.ts')).toThrow(/agents\/bad\.ts/)
  })

  it('test_gathers_toolboxes_and_gates_hitl_tool', () => {
    // A gated tool must reach compiled.tools AND compiled.hitl so the endpoint pauses (M4).
    class OpsTools {
      static readonly tools: ToolDeclaration[] = [
        {
          name: 'deploy',
          description: 'Deploy',
          input: z.object({ env: z.string() }),
          method: 'deploy',
          hitl: { question: 'Deploy?' },
        },
      ]
      async deploy(): Promise<string> {
        return 'ok'
      }
    }

    const compiled = compileAgentModule({
      default: applyCapabilities([new ToolboxCapability(new OpsTools(), { namespace: 'ops' })]),
    })
    expect(compiled.tools.map((t) => t.name)).toContain('ops_deploy')
    expect(compiled.hitl?.get('ops_deploy')).toMatchObject({ question: 'Deploy?' })
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

    const chunks: WireChunk[] = []
    for await (const c of streamAgentUIMessages(compiled, 'sk-test', {
      message: 'hi',
      sessionId: 's1',
    })) {
      chunks.push(c)
    }

    expect(chunks[0]).toEqual({ type: 'start' })
    expect(chunks.some((c) => c.type === 'text-delta' && c.delta === 'hi')).toBe(true)
    expect(chunks.at(-1)).toEqual(FINISH_DONE)
    // apiKey + message + sessionId threaded into the SDK runtime.
    expect(h.calls[0]).toEqual({ apiKey: 'sk-test', message: 'hi', sessionId: 's1' })
  })

  it('test_surfaces_sdk_error_event_as_error_chunk', async () => {
    h.events = [{ type: 'error', code: 'BOOM', message: 'kaboom', retryable: false }]
    h.calls = []
    const compiled = compileAgentModule(defineAgent({ model: 'm' }))

    const chunks: WireChunk[] = []
    // #390 masks a failure's text before it reaches a browser. This case is about the SDK's error
    // event SURFACING as an error chunk, not about what the chunk says, so it opts out explicitly.
    for await (const c of streamAgentUIMessages(compiled, 'k', {
      message: 'x',
      sessionId: 's',
      onError: (e) => e.message,
    })) {
      chunks.push(c)
    }
    expect(chunks.some((c) => c.type === 'error' && c.errorText === 'kaboom')).toBe(true)
    expect(chunks.at(-1)).toEqual({ type: 'finish' })
  })
})

async function collectStream(gen: AsyncIterable<WireChunk>) {
  const chunks: WireChunk[] = []
  for await (const c of gen) chunks.push(c)
  return chunks
}

describe('streamAgentUIMessages — @Checkpoint emit + resume (M4)', () => {
  it('test_checkpoint_saved_emitted_when_checkpoint_declared', async () => {
    h.events = [{ type: 'text_delta', content: 'hi' }, DONE]
    h.calls = []
    h.overrides = []

    const compiled = compileAgentModule({
      default: applyCapabilities([
        new ModelCapability('m'),
        new CheckpointCapability({ resumeSignal: true }),
      ]),
    })
    expect(compiled.checkpoint?.resumeSignal).toBe(true)

    const chunks = await collectStream(
      streamAgentUIMessages(compiled, 'k', { message: 'hi', sessionId: 's1' }),
    )
    // The resume handle rides an ai-sdk-native transient `data-checkpoint` part, keyed by sessionId.
    const cp = chunks.find((c): c is WireDataPart => c.type === 'data-checkpoint')
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

  it('test_no_handle_when_the_agent_did_not_ask_for_the_signal', async () => {
    // G10 honesty, with its premise corrected. This asserted that a `memory` @Checkpoint "cannot
    // resume across requests" while `filesystem` could, and warned so the no-op would not be silent.
    // #724 measured that premise false: the SDK persists EVERY session to its transcript, so neither
    // value selected a store, and the warning sent authors to the one storage a pod without a volume
    // cannot provide.
    //
    // What survives is the invariant that was always real, and the reason the gate exists: an agent
    // that did not ask to advertise a resume handle must not have one advertised for it. The option
    // says that in its name now, so there is nothing left to warn about at walk time.
    h.events = [{ type: 'text_delta', content: 'hi' }, DONE]
    h.calls = []
    h.overrides = []

    const compiled = compileAgentModule({
      default: applyCapabilities([
        new ModelCapability('m'),
        new CheckpointCapability({ resumeSignal: false }),
      ]),
    })
    const chunks = await collectStream(
      streamAgentUIMessages(compiled, 'k', { message: 'hi', sessionId: 's1' }),
    )

    expect(chunks.some((c) => c.type === 'data-checkpoint')).toBe(false)
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
    expect(chunks.at(-1)).toEqual(FINISH_DONE)
  })
})
