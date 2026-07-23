import { describe, expect, it } from 'vitest'

import {
  applyCapabilities,
  CapabilityConflictError,
  type Capability,
  createDraft,
} from '../../src/capability/capability.js'
import {
  ConfigurationError,
  ModelCapability,
  skills,
  ToolsCapability,
} from '../../src/capability/capabilities.js'
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

  it('the draft seeds the waist required fields', () => {
    const d = createDraft()
    expect(d.tools).toEqual([])
    expect(d.agents).toEqual({})
    expect(d.stream).toBe(true)
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
