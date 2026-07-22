/**
 * M35 (multi-surface) — streamAgentTurnInProcess: the in-process agent-turn seam.
 *
 * The FRAMEWORK-owned sibling of the HTTP mount + the stdout `runAgentInTerminal`: SAME
 * `compileAgentModule` + SAME `streamAgentUIMessages`, but returns the raw `UIMessageChunk` generator
 * so ANY consumer (Ink TUI, Tauri) drives it — with HITL resolved INLINE via a caller `awaitApproval`
 * callback (no HTTP second request, no approval registry). Here `@theokit/agents` is stubbed so the
 * stream is deterministic (no LLM); the test proves the WIRING.
 *
 * TDD RED-first.
 */
import { describe, expect, it, vi } from 'vitest'

interface Chunk {
  type: string
  [k: string]: unknown
}

const hoisted = vi.hoisted(() => ({
  chunks: [] as Chunk[],
  lastStreamInput: null as unknown,
  lastCompiled: null as unknown,
  lastApiKey: null as unknown,
  resolveEnabledSkills: null as unknown,
  skillsResolved: [] as unknown[],
}))

vi.mock('@theokit/agents', () => ({
  compileAgentModule: (mod: { __compiled: unknown }) => mod.__compiled,
  resolveEnabledSkills: (selection: unknown, ctx: unknown) => {
    hoisted.skillsResolved.push({ selection, ctx })
    return Promise.resolve(hoisted.resolveEnabledSkills)
  },
  streamAgentUIMessages: (compiled: unknown, apiKey: string, input: unknown) => {
    hoisted.lastCompiled = compiled
    hoisted.lastApiKey = apiKey
    hoisted.lastStreamInput = input
    return (async function* () {
      for (const c of hoisted.chunks) yield c
    })()
  },
}))

const { streamAgentTurnInProcess, InProcessApprovalRequiredError } =
  await import('../../packages/theo/src/server/agent/stream-agent-turn-in-process.js')

const GATED = {
  __compiled: {
    hitl: new Map([['deploy', { question: 'Deploy?', timeout: 12_345 }]]),
    tools: [],
    stream: true,
  },
}
const PLAIN = { __compiled: { tools: [], stream: true } }

async function collect(gen: AsyncIterable<unknown>): Promise<Chunk[]> {
  const out: Chunk[] = []
  for await (const c of gen) out.push(c as Chunk)
  return out
}

describe('streamAgentTurnInProcess (M35)', () => {
  it('passes the compiled agent + message + apiKey through to streamAgentUIMessages', async () => {
    hoisted.chunks = [{ type: 'text-delta', delta: 'hi' }, { type: 'finish' }]
    const chunks = await collect(
      streamAgentTurnInProcess(PLAIN, 'sk-test', { message: 'hello', sessionId: 's1' }),
    )
    expect(chunks.map((c) => c.type)).toEqual(['text-delta', 'finish'])
    expect(hoisted.lastApiKey).toBe('sk-test')
    expect(hoisted.lastCompiled).toBe(PLAIN.__compiled)
    const input = hoisted.lastStreamInput as { message: string; sessionId: string; hitl?: unknown }
    expect(input.message).toBe('hello')
    expect(input.sessionId).toBe('s1')
    expect(input.hitl).toBeUndefined() // non-gated ⇒ no hitl wiring
  })

  it('generates a sessionId when omitted', async () => {
    hoisted.chunks = [{ type: 'finish' }]
    await collect(streamAgentTurnInProcess(PLAIN, 'sk', { message: 'x' }))
    const input = hoisted.lastStreamInput as { sessionId: string }
    expect(typeof input.sessionId).toBe('string')
    expect(input.sessionId.length).toBeGreaterThan(0)
  })

  // M35 (multimodal) — images must pass through to streamAgentUIMessages; a drop here is invisible to a
  // layer-local test (the seam lesson). Assert the value reaches the captured stream input.
  it('threads images through to streamAgentUIMessages when supplied', async () => {
    hoisted.chunks = [{ type: 'finish' }]
    const img = { data: 'aGk=', mimeType: 'image/png' }
    await collect(streamAgentTurnInProcess(PLAIN, 'sk', { message: 'hi', images: [img] }))
    const input = hoisted.lastStreamInput as { images?: unknown }
    expect(input.images).toEqual([img])
  })

  it('omits images on a text-only turn (back-compat)', async () => {
    hoisted.chunks = [{ type: 'finish' }]
    await collect(streamAgentTurnInProcess(PLAIN, 'sk', { message: 'hi' }))
    const input = hoisted.lastStreamInput as { images?: unknown }
    expect(input.images).toBeUndefined()
  })

  it('wires HITL to the inline awaitApproval callback for a gated agent', async () => {
    hoisted.chunks = [{ type: 'finish' }]
    const awaitApproval = vi.fn().mockResolvedValue(true)
    await collect(
      streamAgentTurnInProcess(GATED, 'sk', { message: 'go', sessionId: 's', awaitApproval }),
    )
    const input = hoisted.lastStreamInput as {
      hitl?: {
        gated: Map<string, unknown>
        awaitApproval: (id: string, opts: unknown, name: string) => Promise<unknown>
      }
    }
    expect(input.hitl).toBeDefined()
    expect(input.hitl!.gated).toBe(GATED.__compiled.hitl) // SAME gated map (parity with mount)
    // The SDK calls hitl.awaitApproval(approvalId, opts, toolName); the seam must route it to the
    // caller's inline callback with a structured request.
    const decision = await input.hitl!.awaitApproval('appr-1', { question: 'Deploy?' }, 'deploy')
    expect(decision).toBe(true)
    expect(awaitApproval).toHaveBeenCalledWith({
      approvalId: 'appr-1',
      toolName: 'deploy',
      opts: { question: 'Deploy?' },
    })
  })

  it('resolves function-form skills before streaming (parity with mountAgent)', async () => {
    hoisted.chunks = [{ type: 'finish' }]
    hoisted.skillsResolved = []
    hoisted.resolveEnabledSkills = ['deploy-skill']
    const resolver = () => ['deploy-skill']
    const WITH_SKILLS = {
      __compiled: {
        tools: [],
        stream: true,
        skillsResolver: resolver,
        runContext: { projectRoot: '/x' },
      },
    }
    await collect(streamAgentTurnInProcess(WITH_SKILLS, 'sk', { message: 'go', sessionId: 's' }))
    // resolveEnabledSkills was called with the compiled resolver + run context...
    expect(hoisted.skillsResolved).toHaveLength(1)
    expect(hoisted.skillsResolved[0]).toMatchObject({
      selection: resolver,
      ctx: { projectRoot: '/x' },
    })
    // ...and the resolved skills were applied to the compiled agent before streaming.
    expect(WITH_SKILLS.__compiled).toMatchObject({
      skills: { enabled: ['deploy-skill'], autoInject: true },
    })
  })

  it('does not call resolveEnabledSkills for a static (no-resolver) agent', async () => {
    hoisted.chunks = [{ type: 'finish' }]
    hoisted.skillsResolved = []
    await collect(streamAgentTurnInProcess(PLAIN, 'sk', { message: 'x', sessionId: 's' }))
    expect(hoisted.skillsResolved).toHaveLength(0)
  })

  it('fails fast when a gated agent is run without an awaitApproval resolver', () => {
    // Constructing the generator eagerly-validates: a gated agent with no inline resolver would
    // silently BYPASS the human gate (like #99) — refuse loudly instead (Rule 8, fail-closed).
    expect(() => streamAgentTurnInProcess(GATED, 'sk', { message: 'go' })).toThrow(
      InProcessApprovalRequiredError,
    )
  })
})
