import 'reflect-metadata'
import { describe, expect, it } from 'vitest'

import { compileAgent, type CompiledAgentOptions } from '../../src/bridge/agent-compiler.js'
import { compileAgentDefinition, defineAgent } from '../../src/bridge/define-agent.js'
import { walkAgentMetadata } from '../../src/bridge/walk-agent-metadata.js'
import { Agent as DecoratorAgent } from '../../src/decorators/agent.js'
import { MainLoop } from '../../src/decorators/main-loop.js'
import { Skills } from '../../src/decorators/skills.js'
import { assembleM8CreateOptions } from '../../src/bridge/sdk-adapter-create-options.js'
import { applyCapabilities } from '../../src/capability/capability.js'
import { ModelCapability, skills, ToolsCapability } from '../../src/capability/capabilities.js'
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
 * The waist's COMPLETE field set, derived from the type — `satisfies` rejects a name that is not a
 * real field, and the `_Exhaustive` check below fails to COMPILE if `CompiledAgentOptions` gains a
 * field nobody classified. The universe cannot drift away from reality silently.
 */
type WaistField = keyof CompiledAgentOptions
const WAIST_FIELDS = [
  'model',
  'reasoningEffort',
  'parseThinkTags',
  'stripToolDialect',
  'recoverLeakedToolCalls',
  'systemPrompt',
  'settingSources',
  'plugins',
  'tools',
  'agents',
  'memory',
  'skills',
  'context',
  'runContext',
  'projectContext',
  'mcpServers',
  'maxIterations',
  'timeoutMs',
  'stream',
  'hitl',
  'checkpoint',
  'guardrails',
  'skillsResolver',
] as const satisfies readonly WaistField[]

/** Compile-time exhaustiveness: a new waist field must be classified here before tests compile. */
type _Exhaustive =
  Exclude<WaistField, (typeof WAIST_FIELDS)[number]> extends never
    ? true
    : ['unclassified waist field']
const WAIST_FIELDS_ARE_EXHAUSTIVE: _Exhaustive = true

/**
 * Waist fields NO capability can express yet. Every one must gain a capability (or an ADR dropping
 * it) before M53 may delete `src/decorators/`. `satisfies` makes a fabricated name a compile error;
 * the assertion below is exact set equality, so an over-claim fails just as loudly as an omission.
 */
const NOT_EXPRESSIBLE_YET = [
  'parseThinkTags',
  'stripToolDialect',
  'recoverLeakedToolCalls',
  'systemPrompt',
  'settingSources',
  'plugins',
  'memory',
  'context',
  'runContext',
  'projectContext',
  'mcpServers',
  'maxIterations',
  'timeoutMs',
  'hitl',
  'checkpoint',
  'guardrails',
  'skillsResolver',
] as const satisfies readonly WaistField[]

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

  it('the waist field list is exhaustive (fails to COMPILE if a new field is unclassified)', () => {
    expect(WAIST_FIELDS_ARE_EXHAUSTIVE).toBe(true)
  })

  it('PINS the gap by DERIVING both sides — an over-claim fails as loudly as an omission', () => {
    // expressible = what the layer ACTUALLY produces when every capability it ships is applied.
    // Deriving it (instead of hardcoding) is what makes this assertion able to fail: the earlier
    // version unioned its own answer into the question and passed for any fabricated field.
    const everything = applyCapabilities([
      new ModelCapability('openai/gpt-5.4', 'high'),
      new ToolsCapability([{ name: 't' } as never]),
      skills(['a']),
    ])
    const expressible = new Set(Object.keys(everything).filter((k) => k !== 'provenance'))
    const gap = WAIST_FIELDS.filter((f) => !expressible.has(f))

    expect([...gap].sort((a, b) => a.localeCompare(b))).toEqual(
      [...NOT_EXPRESSIBLE_YET].sort((a, b) => a.localeCompare(b)),
    )
  })

  it('the decorator compiler DOES emit fields no capability expresses — the deletion is not free', () => {
    @DecoratorAgent({
      name: 'rich',
      route: '/rich',
      model: 'openai/gpt-5.4',
      systemPrompt: 'you are rich',
      parseThinkTags: true,
      stripToolDialect: true,
      recoverLeakedToolCalls: true,
      maxIterations: 7,
      timeoutMs: 1234,
    })
    class Rich {
      @MainLoop()
      async run(): Promise<void> {}
    }

    const decorated = compileAgent(walkAgentMetadata(Rich))
    const everything = applyCapabilities([new ModelCapability('openai/gpt-5.4')])
    const emittedButUnexpressible = Object.entries(decorated)
      .filter(([k, v]) => v !== undefined && !(k in everything))
      .map(([k]) => k)

    // These are live in the decorator path today and have NO capability replacement.
    expect(emittedButUnexpressible).toEqual(
      expect.arrayContaining([
        'systemPrompt',
        'parseThinkTags',
        'stripToolDialect',
        'recoverLeakedToolCalls',
        'maxIterations',
        'timeoutMs',
      ]),
    )
    for (const field of emittedButUnexpressible) {
      expect(NOT_EXPRESSIBLE_YET as readonly string[]).toContain(field)
    }
  })
})
