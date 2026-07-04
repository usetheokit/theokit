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
import { describe, expect, expectTypeOf, it } from 'vitest'
import { z } from 'zod'

import {
  compileAgentDefinition,
  defineAgent,
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
})
