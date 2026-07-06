/**
 * M8 — the `agent()` builder is a TYPE-STATE wrapper whose `.build()` resolves to the SAME branded
 * `AgentDefinition` the `defineAgent` / `@Agent` surfaces produce (ADR-B1, one runtime N syntaxes).
 *
 * Two properties proven here at runtime:
 *  1. CONVERGENCE — a builder chain and the equivalent `defineAgent({...})` produce equal branded
 *     definitions and equal compiled options (so the scanner/manifest/runtime cannot tell them apart).
 *  2. RUNTIME — a builder-built agent runs through `createSdkAgentStream` and the `.context()` value
 *     reaches the tool handler (M7 seam), just like `defineAgent({ context })`.
 */
import 'reflect-metadata'
import { describe, expect, it, beforeEach, vi } from 'vitest'

import type { CustomTool } from '@theokit/sdk'

const h = vi.hoisted(() => ({ handlerContext: undefined as unknown }))

// @theokit/sdk mock (same contract as run-context.test.ts): send invokes the first tool handler
// with NO ctx — theokit injects the run-context at the adapter layer — and yields a FINISHED stream.
vi.mock('@theokit/sdk', () => ({
  InMemoryConversationStorage: class {
    getMessages = async () => []
    appendMessage = async () => {}
  },
  FileSystemConversationStorage: class {
    getMessages = async () => []
    appendMessage = async () => {}
  },
  defineTool: (spec: unknown) => spec,
  Agent: {
    getOrCreate: vi.fn(
      async (_id: string, opts: { tools?: Array<{ handler: (i: unknown) => unknown }> }) => {
        const tools = opts.tools ?? []
        return {
          send: async () => {
            if (tools[0]) await tools[0].handler({})
            return {
              stream: async function* () {
                yield { type: 'status', status: 'FINISHED' }
              },
              wait: async () => ({}),
            }
          },
          dispose: async () => {},
        }
      },
    ),
  },
}))

const { agent } = await import('../../src/bridge/agent-builder.js')
const { defineAgent, compileAgentDefinition, isAgentDefinition } =
  await import('../../src/bridge/define-agent.js')
const { createSdkAgentStream } = await import('../../src/bridge/sdk-adapter.js')

const tool: CustomTool = {
  name: 'echo',
  description: 'echoes',
  inputSchema: {},
  // ctx widened to read the theokit-injected `context` (see run-context.test.ts note).
  handler: (_input, ctx?: { signal?: AbortSignal; context?: unknown }) => {
    h.handlerContext = ctx?.context
    return 'ok'
  },
}

async function drain(stream: AsyncIterable<unknown>): Promise<void> {
  for await (const _ of stream) {
    // consume
  }
}

describe('M8 agent() builder', () => {
  beforeEach(() => {
    h.handlerContext = undefined
  })

  it('converges: builder output equals the equivalent defineAgent output (branded + compiled)', () => {
    const built = agent().model('claude-sonnet-4-6').system('be terse').tool(tool).build()
    const declared = defineAgent({
      model: 'claude-sonnet-4-6',
      system: 'be terse',
      tools: [tool],
    })

    // Same branded value the scanner recognizes.
    expect(isAgentDefinition(built)).toBe(true)
    expect(built).toEqual(declared)
    // Same compiled options the runtime consumes — the true convergence contract. Compiled tool
    // handlers are fresh closures per call (not reference-equal), so compare the observable shape:
    // model, systemPrompt, and the tool-name list.
    const cBuilt = compileAgentDefinition(built)
    const cDeclared = compileAgentDefinition(declared)
    expect(cBuilt.model).toBe(cDeclared.model)
    expect(cBuilt.systemPrompt).toBe(cDeclared.systemPrompt)
    expect(cBuilt.tools.map((t) => t.name)).toEqual(cDeclared.tools.map((t) => t.name))
  })

  it('carries .context() to the built definition and on to the tool handler at runtime (M7 seam)', async () => {
    const def = agent().model('m').context({ projectRoot: '/repo' }).tool(tool).build()

    // The run-context landed on the branded definition ...
    expect(def.context).toEqual({ projectRoot: '/repo' })

    // ... and reaches the tool handler through the SDK adapter.
    const compiled = compileAgentDefinition(def)
    const factory = createSdkAgentStream(compiled, compiled.tools, 'test-key')
    await drain(factory('go', 'sess-1'))
    expect(h.handlerContext).toEqual({ projectRoot: '/repo' })
  })

  it('.use(preset) applies a partial chain and preserves type-state (model set before .use flows through)', () => {
    // `b` is inferred as the model-set builder, so the preset's added system/tool flow through and
    // `.build()` is callable without re-setting the model — proving `.use()` carries the type-state.
    const built = agent()
      .model('m')
      .use((b) => b.system('log everything').tool(tool))
      .build()

    expect(isAgentDefinition(built)).toBe(true)
    expect(built.system).toBe('log everything')
    expect(built.tools).toEqual([tool])
    expect(built.model).toBe('m')
  })
})
