import { describe, expect, it } from 'vitest'

import { compileAgentDefinition, defineAgent } from '../../src/bridge/define-agent.js'
import { assembleM8CreateOptions } from '../../src/bridge/sdk-adapter-create-options.js'
import { applyCapabilities } from '../../src/capability/capability.js'
import { ModelCapability, skills } from '../../src/capability/capabilities.js'
import { CapabilityRegistry } from '../../src/capability/registry.js'

/**
 * M52 T0.4 — ZERO-BEHAVIOR proof. The capability path must produce the SAME `CompiledAgentOptions`
 * (the existing narrow waist) as the canonical `defineAgent` source, and therefore the SAME
 * `Agent.create` options out of the shared adapter. This is what authorizes M53 to delete the
 * decorator source: the new authoring is provably equivalent at the waist AND at the adapter.
 */

/** The draft carries `provenance` (new diagnostics) — not part of the waist, so it is stripped. */
function waistOf(draft: Record<string, unknown>): Record<string, unknown> {
  const { provenance: _p, ...waist } = draft
  return waist
}

describe('capability path ≡ defineAgent path (zero-behavior)', () => {
  it('produces a byte-identical CompiledAgentOptions for the same logical agent', () => {
    const reference = compileAgentDefinition(
      defineAgent({ model: 'openai/gpt-5.4', skills: ['code-review', 'testing'] }),
    )
    const viaCapabilities = applyCapabilities([
      new ModelCapability('openai/gpt-5.4'),
      skills(['code-review', 'testing']),
    ])
    expect(waistOf(viaCapabilities as unknown as Record<string, unknown>)).toEqual(reference)
  })

  it('produces byte-identical Agent.create options through the SHARED adapter', () => {
    const def = defineAgent({ model: 'openai/gpt-5.4', skills: ['code-review'] })
    const fromDefine = assembleM8CreateOptions(compileAgentDefinition(def))
    const fromCapabilities = assembleM8CreateOptions(
      waistOf(
        applyCapabilities([
          new ModelCapability('openai/gpt-5.4'),
          skills(['code-review']),
        ]) as unknown as Record<string, unknown>,
      ) as never,
    )
    expect(fromCapabilities.options).toEqual(fromDefine.options)
    expect(fromCapabilities.applied).toEqual(fromDefine.applied)
  })

  it('the FILE-BASED path (registry) reaches the same waist — the Agent Builder authoring route', () => {
    const registry = new CapabilityRegistry()
      .register('model', (id) => new ModelCapability(id as string))
      .register('skills', (names) => skills(names as string[]))
    const fromFile = applyCapabilities(
      [
        { name: 'model', arg: 'openai/gpt-5.4' },
        { name: 'skills', arg: ['code-review'] },
      ].map((c) => registry.resolve(c.name, c.arg)),
    )
    const reference = compileAgentDefinition(
      defineAgent({ model: 'openai/gpt-5.4', skills: ['code-review'] }),
    )
    expect(waistOf(fromFile as unknown as Record<string, unknown>)).toEqual(reference)
  })
})
