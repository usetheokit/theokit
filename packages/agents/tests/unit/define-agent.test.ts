/**
 * M2 (theokit-ai-first) — defineAgent, the zero-config imperative agent surface.
 *
 * `defineAgent({...})` is the canonical file-convention surface (ADR-B1): a top-level
 * `agents/<name>.ts` default-exports it, and the framework auto-wires an SSE endpoint +
 * a typed client binding. It is an identity/normalizer (like `defineRoute`) — it does NOT
 * compile at define time; `compileAgentDefinition` lowers it to the SDK-ready
 * `CompiledAgentOptions` at mount time so a file import stays cheap.
 *
 * Contract:
 * - The returned value is branded (a global `Symbol.for` tag) so the scanner can
 *   distinguish it from a `@Agent`-decorated class and from a plain object.
 * - The `input` Zod schema is preserved AND lifted to a type param (`InferAgentInput`)
 *   so the generated client request type = `z.infer<typeof input>` (end-to-end inference).
 * - `compileAgentDefinition` produces `{ systemPrompt, model, tools, agents:{}, stream:true }`
 *   — the same shape `compileAgent` produces for the decorator path (convergence).
 */
import type { CustomTool } from '@theokit/sdk'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { z } from 'zod'

import {
  compileAgentDefinition,
  defineAgent,
  type DefineAgentConfig,
  isAgentDefinition,
  type InferAgentInput,
} from '../../src/bridge/define-agent.js'

describe('defineAgent (M2)', () => {
  it('test_defineAgent_returns_branded_definition_preserving_config', () => {
    const def = defineAgent({
      input: z.object({ message: z.string() }),
      model: 'claude-sonnet-4-6',
      system: 'You are a support agent.',
    })
    expect(isAgentDefinition(def)).toBe(true)
    expect(def.model).toBe('claude-sonnet-4-6')
    expect(def.system).toBe('You are a support agent.')
    expect(def.input).toBeDefined()
  })

  it('test_defineAgent_tools_accepts_sdk_CustomTool (issue #81)', () => {
    // `defineAgentTool` (theokit/server) and every `@theokit/sdk-tools` factory return the
    // SDK `CustomTool`. The `tools` field MUST accept it — the runtime already routes it
    // (buildSdkTools), so the type contract has to agree or the documented pattern
    // `defineAgent({ tools: [defineAgentTool(...)] })` fails `tsc`.
    const sdkTools = [] as unknown as CustomTool[]
    const cfg: DefineAgentConfig = { tools: sdkTools }
    expectTypeOf<CustomTool[]>().toExtend<NonNullable<DefineAgentConfig['tools']>>()
    expect(cfg.tools).toBe(sdkTools)
  })

  it('preserves symbol-keyed tool metadata through compile (a2a subagent credential sink)', () => {
    // A `@theokit/sdk/a2a` SubAgent installs its credential-inheritance sink under a `Symbol.for` key.
    // `compileAgentDefinition` must carry symbol-keyed props onto the compiled tool — copying only the
    // 4 known fields drops the sink, so the SDK runtime can't hand the parent's apiKey to the child
    // (child fails with `provider_unresolved` / "(no response)"). Regression for the a2a-in-adapter path.
    const SINK = Symbol.for('theokit.subagent.inheritCredentials')
    let received: unknown
    const subTool = {
      name: 'sub',
      description: 'delegates',
      inputSchema: { type: 'object', properties: { input: { type: 'string' } } },
      handler: async () => 'ok',
      [SINK]: (creds: unknown) => {
        received = creds
      },
    } as unknown as CustomTool
    const compiled = compileAgentDefinition(defineAgent({ model: 'm', tools: [subTool] }))
    const sink = (compiled.tools[0] as unknown as Record<symbol, (c: unknown) => void>)[SINK]
    expect(typeof sink).toBe('function')
    sink({ apiKey: 'k' })
    expect(received).toEqual({ apiKey: 'k' })
  })

  it('test_isAgentDefinition_rejects_non_agent_values', () => {
    expect(isAgentDefinition({ model: 'x' })).toBe(false)
    expect(isAgentDefinition(null)).toBe(false)
    expect(isAgentDefinition(undefined)).toBe(false)
    expect(isAgentDefinition('agent')).toBe(false)
  })

  it('test_compileAgentDefinition_normalizes_to_CompiledAgentOptions', () => {
    const def = defineAgent({ model: 'm', system: 's', tools: [] })
    const compiled = compileAgentDefinition(def)
    expect(compiled).toMatchObject({
      model: 'm',
      systemPrompt: 's',
      tools: [],
      agents: {},
      stream: true,
    })
  })

  it('test_compileAgentDefinition_defaults_tools_when_absent', () => {
    const compiled = compileAgentDefinition(defineAgent({ model: 'm' }))
    expect(compiled.tools).toEqual([])
    expect(compiled.systemPrompt).toBeUndefined()
  })

  it('test_input_type_param_infers_request_shape', () => {
    const def = defineAgent({ input: z.object({ message: z.string(), n: z.number() }) })
    expect(isAgentDefinition(def)).toBe(true)
    type Input = InferAgentInput<typeof def>
    expectTypeOf<Input>().toEqualTypeOf<{ message: string; n: number }>()
  })

  it('test_agent_without_input_infers_unknown_not_any', () => {
    // EC-2: an agent with no `input` schema degrades to `unknown` (type-safe — the caller
    // must narrow before use), NEVER `any`. This deviates from the blueprint's `{message}`
    // nicety in favor of the honest safe default (a no-schema agent has no known shape).
    const def = defineAgent({ model: 'm' })
    expect(isAgentDefinition(def)).toBe(true)
    type Input = InferAgentInput<typeof def>
    expectTypeOf<Input>().toEqualTypeOf<unknown>()
  })
})
