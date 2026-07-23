import 'reflect-metadata'
import { describe, expect, it } from 'vitest'

import { compileAgent } from '../../src/bridge/agent-compiler.js'
import { compileAgentDefinition, defineAgent } from '../../src/bridge/define-agent.js'
import { walkAgentMetadata } from '../../src/bridge/walk-agent-metadata.js'
import { Agent as DecoratorAgent } from '../../src/decorators/agent.js'
import { MainLoop } from '../../src/decorators/main-loop.js'
import { Skills } from '../../src/decorators/skills.js'
import { assembleM8CreateOptions } from '../../src/bridge/sdk-adapter-create-options.js'
import { applyCapabilities } from '../../src/capability/capability.js'
import { ModelCapability, skills } from '../../src/capability/capabilities.js'
import { CapabilityRegistry } from '../../src/capability/registry.js'

/**
 * M52 T0.4 — ZERO-BEHAVIOR proof. Equivalence is DEEP-EQUAL, not textual: top-level key order
 * differs between the two paths and is NOT part of the contract (nothing in the package serializes
 * or hashes compiled options — `Object.keys` appears only over nested values, see
 * sdk-adapter-create-options.ts:76,91). The capability path must produce the SAME `CompiledAgentOptions`
 * (the existing narrow waist) as the canonical `defineAgent` source, and therefore the SAME
 * `Agent.create` options out of the shared adapter. This is what authorizes M53 to delete the
 * decorator source: the new authoring is provably equivalent at the waist AND at the adapter.
 */

/**
 * Waist fields only the DECORATOR path can produce today. Every one of them must gain a capability
 * (or an explicit ADR dropping it) before M53 may delete `src/decorators/`.
 */
const DECORATOR_ONLY_FIELDS = [
  'systemPrompt',
  'hitl',
  'checkpoint',
  'context',
  'projectContext',
  'mcpServers',
  'guardrails',
  'memory',
  'maxIterations',
  'timeoutMs',
] as const

/** The draft carries `provenance` (new diagnostics) — not part of the waist, so it is stripped. */
function waistOf(draft: Record<string, unknown>): Record<string, unknown> {
  const { provenance: _p, ...waist } = draft
  return waist
}

describe('capability path ≡ defineAgent path (zero-behavior)', () => {
  it('produces a deep-equal CompiledAgentOptions for the same logical agent', () => {
    const reference = compileAgentDefinition(
      defineAgent({ model: 'openai/gpt-5.4', skills: ['code-review', 'testing'] }),
    )
    const viaCapabilities = applyCapabilities([
      new ModelCapability('openai/gpt-5.4'),
      skills(['code-review', 'testing']),
    ])
    expect(waistOf(viaCapabilities as unknown as Record<string, unknown>)).toEqual(reference)
  })

  it('produces equivalent Agent.create options through the SHARED adapter', () => {
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

/**
 * The proof that actually matters for M53: equivalence against `compileAgent` — the DECORATOR
 * compiler, which is the artifact M53 deletes. The `defineAgent` comparison above is necessary but
 * NOT sufficient: `defineAgent` is not going away, so proving equality with it never licensed the
 * deletion. This block also PINS, as executable data, which waist fields the capability layer can
 * and cannot yet express — that gap list is M53's entry criterion, not a footnote.
 */
describe('capability path vs the DECORATOR path (the artifact M53 deletes)', () => {
  it('matches compileAgent on every field the capability layer can express', () => {
    @DecoratorAgent({ name: 'x', route: '/x', model: 'openai/gpt-5.4' })
    @Skills(['code-review'])
    class Decorated {
      @MainLoop()
      async run(): Promise<void> {}
    }

    const viaDecorators = compileAgent(walkAgentMetadata(Decorated))
    const viaCapabilities = applyCapabilities([
      new ModelCapability('openai/gpt-5.4'),
      skills(['code-review']),
    ])

    for (const field of ['model', 'skills', 'tools', 'agents', 'stream'] as const) {
      expect({ field, value: viaCapabilities[field] }).toEqual({
        field,
        value: viaDecorators[field],
      })
    }
  })

  it('PINS the waist fields no capability can express yet — M53 entry criterion, not a footnote', () => {
    const draft = applyCapabilities([new ModelCapability('openai/gpt-5.4')])
    const expressible = new Set([...Object.keys(draft), 'reasoningEffort', 'skillsResolver'])
    const reference = compileAgentDefinition(defineAgent({ model: 'openai/gpt-5.4' }))
    const waistFields = new Set([...Object.keys(reference), ...DECORATOR_ONLY_FIELDS])
    const gap = [...waistFields]
      .filter((f) => !expressible.has(f))
      .sort((a, b) => a.localeCompare(b))

    // Deleting the decorator source while these have no replacement would REMOVE authoring surface.
    expect(gap).toEqual([...DECORATOR_ONLY_FIELDS].sort((a, b) => a.localeCompare(b)))
  })
})
