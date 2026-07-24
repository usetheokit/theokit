import { describe, expect, it } from 'vitest'

import { compileAgentDefinition, defineAgent } from '../../src/bridge/define-agent.js'

import {
  applyCapabilities,
  CapabilityConflictError,
  type Capability,
  createDraft,
  setOnce,
} from '../../src/capability/capability.js'
import { ModelCapability, skills, ToolsCapability } from '../../src/capability/capabilities.js'
import { ConfigurationError } from '../../src/errors.js'
import {
  CapabilityPreset,
  CapabilityRegistry,
  UnknownCapabilityError,
} from '../../src/capability/registry.js'

const fakeTool = (name: string) => ({ name }) as never

describe('Capability contract (M52 T0.1)', () => {
  it('applies a capability and records provenance (wiring is inspectable DATA)', () => {
    const draft = applyCapabilities([new ModelCapability('openai/gpt-5.4')])
    expect(draft.model).toBe('openai/gpt-5.4')
    expect(draft.provenance).toEqual([{ capability: 'model', contributed: ['model'] }])
  })

  it('a conflicting redeclaration is a TYPED error, never last-wins', () => {
    expect(() =>
      applyCapabilities([new ModelCapability('a/b'), new ModelCapability('c/d')]),
    ).toThrow(CapabilityConflictError)
  })

  it('re-declaring the SAME value is idempotent (not a conflict)', () => {
    const draft = applyCapabilities([new ModelCapability('a/b'), new ModelCapability('a/b')])
    expect(draft.model).toBe('a/b')
  })

  it('the draft seeds the collection fields but NOT stream (so stream:false stays reachable)', () => {
    const d = createDraft()
    expect(d.tools).toEqual([])
    expect(d.agents).toEqual({})
    expect(d.stream).toBeUndefined()
    // the default is applied at finalize, not seeded — a seeded value would make any capability
    // declaring `stream: false` collide with a default nobody wrote.
    expect(applyCapabilities([]).stream).toBe(true)
  })
})

/**
 * Regressions from the M52 adversarial review. Each `it` below reproduces a defect the review
 * found in the first cut; they fail against that cut and pass against the fix.
 */
describe('Adversarial-review regressions (M52)', () => {
  it('V3 — re-declaring the SAME logical value is idempotent, not a spurious conflict', () => {
    // `compileSkillsSelection` returns a FRESH object per call, so a reference-identity check
    // reported two identical declarations as a conflict.
    const twice: Capability = {
      name: 'm',
      apply: (d) => new ModelCapability('openai/gpt-5.4').apply(d),
    }
    expect(() => applyCapabilities([twice, twice])).not.toThrow()
  })

  it('V3 — a genuinely different value still fails fast and typed', () => {
    expect(() => applyCapabilities([new ModelCapability('a'), new ModelCapability('b')])).toThrow(
      CapabilityConflictError,
    )
  })

  it('V3 — stream:false is reachable (it was structurally blocked by the seeded default)', () => {
    const streamOff: Capability = {
      name: 'stream',
      apply: (d) => {
        d.stream = false
        d.provenance.push({ capability: 'stream', contributed: ['stream'] })
      },
    }
    expect(applyCapabilities([streamOff]).stream).toBe(false)
  })

  it('V4 — skills ACCUMULATE across capabilities (a preset baseline stays extensible)', () => {
    // With setOnce, a preset declaring baseline skills could never be extended at the call site —
    // which defeats the Composite. The reference compiler treats skills as a merge-semantics field.
    const preset = new CapabilityPreset('preset', [skills(['code-review'])])
    const draft = applyCapabilities([preset, skills(['testing'])])
    expect(draft.skills).toEqual({ enabled: ['code-review', 'testing'], autoInject: true })
  })

  it('V5 — a wrong-typed FILE value fails fast and typed, never corrupts silently', () => {
    const registry = new CapabilityRegistry()
      .register('model', (id) => new ModelCapability(id as string))
      .register('skills', (names) => skills(names as string[]))
    // `skills: "code-review"` used to spread into ELEVEN single-character skill names, with no error.
    expect(() => registry.resolve('skills', 'code-review')).toThrow(ConfigurationError)
    expect(() => registry.resolve('skills', ['ok', 42])).toThrow(ConfigurationError)
    expect(() => registry.resolve('model', 42)).toThrow(ConfigurationError)
    expect(() => registry.resolve('model', null)).toThrow(ConfigurationError)
  })

  it('V5 — the typed error names the offending type but never echoes the value', () => {
    // config files can carry secrets: report the SHAPE, never the content.
    expect(() => skills('sk-secret-value' as never)).toThrow(
      /esperava array de nomes, recebi string/,
    )
  })
})

describe('Concrete capabilities (M52 T0.2)', () => {
  it('ModelCapability validates a non-empty id (fail-fast at authoring time)', () => {
    expect(() => new ModelCapability('   ')).toThrow(ConfigurationError)
  })

  it('ToolsCapability ACCUMULATES instead of overwriting', () => {
    const draft = applyCapabilities([
      new ToolsCapability([fakeTool('a')]),
      new ToolsCapability([fakeTool('b')]),
    ])
    expect(draft.tools.map((t) => (t as { name: string }).name)).toEqual(['a', 'b'])
  })

  it('skills is a plain factory (pure data — a class here would be ceremony)', () => {
    const draft = applyCapabilities([skills(['code-review', 'testing'])])
    expect(draft.skills).toEqual({ enabled: ['code-review', 'testing'], autoInject: true })
  })
})

describe('Registry + Preset (M52 T0.3)', () => {
  it('resolves by name — the seam that unlocks FILE-BASED authoring', () => {
    const reg = new CapabilityRegistry()
      .register('model', (id) => new ModelCapability(id as string))
      .register('skills', (n) => skills(n as string[]))
    const draft = applyCapabilities([reg.resolve('model', 'x/y'), reg.resolve('skills', ['s'])])
    expect(draft.model).toBe('x/y')
    expect(draft.skills).toEqual({ enabled: ['s'], autoInject: true })
  })

  it('an unknown capability fails fast and lists the known ones', () => {
    const reg = new CapabilityRegistry().register(
      'model',
      (id) => new ModelCapability(id as string),
    )
    expect(() => reg.resolve('nope')).toThrow(UnknownCapabilityError)
    expect(() => reg.resolve('nope')).toThrow(/não registrada.*model/)
  })

  it('a preset behaves like ONE capability and applies members in declaration order', () => {
    const preset = new CapabilityPreset('preset:coding', [
      new ModelCapability('openai/gpt-5.4'),
      skills(['code-review']),
      new ToolsCapability([fakeTool('shell')]),
    ])
    const order: string[] = []
    const spy: Capability = {
      name: 'spy',
      apply: (d) => order.push(...d.provenance.map((p) => p.capability)),
    }
    const draft = applyCapabilities([preset, spy])
    expect(draft.model).toBe('openai/gpt-5.4')
    expect(draft.skills).toEqual({ enabled: ['code-review'], autoInject: true })
    expect(draft.tools).toHaveLength(1)
    expect(order).toEqual(['model', 'skills', 'tools']) // ordem determinística
  })
})

/**
 * Regressions from the SECOND adversarial review (it attacked the fixes above and broke four of
 * six vectors). Each `it` reproduces a defect the FIXES introduced.
 */
describe('Second-review regressions (M52)', () => {
  it('the capability list IS the authoring list — concat, matching the reference exactly', () => {
    // A dedupe was tried here (a review asked for it) and REVERTED: it made the merge path the only
    // place in this layer that diverges from the reference compiler. The faithful rule is that
    // composing N capabilities corresponds to authoring their concatenation, in order.
    const equivalent = (caps: Capability[], authored: string[]): void => {
      expect(applyCapabilities(caps).skills).toEqual(
        compileAgentDefinition(defineAgent({ skills: authored })).skills,
      )
    }
    equivalent([skills(['a', 'a'])], ['a', 'a']) // author's own duplicate survives, as upstream
    equivalent([skills(['a']), skills(['b'])], ['a', 'b']) // ordered concatenation
    equivalent([skills(['a']), skills(['a'])], ['a', 'a']) // two capabilities ≡ authoring twice
  })

  it('a malformed inline skill is rejected — it would reach the system prompt with holes', () => {
    // `InlineSkill extends Skill` requires name + description + instructions. Accepting `{name}`
    // alone reopened the silent-corruption class one level below the array check.
    expect(() => skills([{ name: 'x' } as never])).toThrow(ConfigurationError)
    expect(() => skills([{ name: 'x', description: 'd' } as never])).toThrow(/instructions/)
    expect(() => skills([{ name: 'x', description: 'd', instructions: '  ' } as never])).toThrow(
      ConfigurationError,
    )
    expect(() =>
      skills([{ name: 'x', description: 'd', instructions: 'body' } as never]),
    ).not.toThrow()
  })

  it('inline skills are accepted — the layer must not be LESS expressive than the reference', () => {
    // `compileSkillsSelection` accepts `string | InlineSkill`; validating "strings only" made
    // `skills.inline` unreachable through capabilities.
    const inline = { name: 'my-inline', description: 'd', instructions: 'body' }
    const draft = applyCapabilities([skills([inline as never, 'code-review'])])
    expect(draft.skills).toEqual({
      enabled: ['code-review'],
      autoInject: true,
      inline: [inline],
    })
  })

  it('a conflict message reports the SHAPE, never the value (config files carry secrets)', () => {
    const secret = { github: { headers: { Authorization: 'Bearer sk-live-DO-NOT-LEAK' } } }
    const set = (v: unknown): Capability => ({
      name: 'mcp',
      apply: (d) => setOnce(d, 'mcpServers', v as never, 'mcp'),
    })
    let message = ''
    try {
      applyCapabilities([set(secret), set({ github: { headers: { Authorization: 'other' } } })])
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toContain('mcpServers')
    expect(message).not.toContain('sk-live-DO-NOT-LEAK')
    expect(message).toContain('object{github}')
  })

  it('setOnce with undefined never consumes the slot', () => {
    const d = createDraft()
    setOnce(d, 'model', undefined, 'noop')
    expect(d.model).toBeUndefined()
    expect(d.provenance).toEqual([]) // a no-op contributed nothing
    expect(() => setOnce(d, 'model', 'openai/gpt-5.4', 'later')).not.toThrow()
  })
})
