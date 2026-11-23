/**
 * M13 (theokit-ai-first) — defineAgent({ skills }) accepts a static list OR a per-request resolver.
 *
 * A static array compiles straight to the SDK `skills.enabled`. A resolver function is carried on
 * `compiled.skillsResolver` for the request path to resolve (via `resolveEnabledSkills`) against the
 * run-context. This closes the M13 config surface.
 *
 * TDD RED-first.
 */
import { describe, expect, it } from 'vitest'

import { Skill } from '@theokit/sdk'

import { compileAgentDefinition, defineAgent } from '../../src/bridge/define-agent.js'
import { resolveEnabledSkills } from '../../src/skills-resolver.js'

describe('M13 — defineAgent({ skills })', () => {
  it('compiles a static skill list to SDK skills.enabled', () => {
    const compiled = compileAgentDefinition(defineAgent({ model: 'm', skills: ['a', 'b'] }))
    expect(compiled.skills).toEqual({ enabled: ['a', 'b'], autoInject: true })
    expect(compiled.skillsResolver).toBeUndefined()
  })

  it('carries a resolver function on compiled.skillsResolver (not in skills)', () => {
    const resolver = (ctx: Record<string, unknown>) => (ctx.role === 'admin' ? ['x'] : [])
    const compiled = compileAgentDefinition(defineAgent({ model: 'm', skills: resolver }))
    expect(compiled.skills).toBeUndefined()
    expect(compiled.skillsResolver).toBe(resolver)
  })

  it('the carried resolver resolves per-context via resolveEnabledSkills', async () => {
    const resolver = (ctx: Record<string, unknown>) => (ctx.role === 'admin' ? ['x'] : ['y'])
    const compiled = compileAgentDefinition(defineAgent({ model: 'm', skills: resolver }))
    expect(await resolveEnabledSkills(compiled.skillsResolver, { role: 'admin' })).toEqual(['x'])
    expect(await resolveEnabledSkills(compiled.skillsResolver, { role: 'guest' })).toEqual(['y'])
  })

  it('leaves both undefined when no skills are declared', () => {
    const compiled = compileAgentDefinition(defineAgent({ model: 'm' }))
    expect(compiled.skills).toBeUndefined()
    expect(compiled.skillsResolver).toBeUndefined()
  })

  // Inline skills (Skill.create) — the SDK injects their name+description into the `<skills>` block via
  // `skills.inline` (autoInject). The builder must accept the objects, not just filesystem names.
  const briefing = Skill.create({
    name: 'daily-briefing',
    description: 'A morning briefing',
    instructions: 'do X',
  })

  it('routes an inline Skill.create object to skills.inline (enabled empty)', () => {
    const compiled = compileAgentDefinition(defineAgent({ model: 'm', skills: [briefing] }))
    expect(compiled.skills).toEqual({ enabled: [], inline: [briefing], autoInject: true })
    expect(compiled.skillsResolver).toBeUndefined()
  })

  it('splits a mixed list into enabled (names) + inline (objects)', () => {
    const compiled = compileAgentDefinition(
      defineAgent({ model: 'm', skills: ['fs-skill', briefing] }),
    )
    expect(compiled.skills).toEqual({ enabled: ['fs-skill'], inline: [briefing], autoInject: true })
  })

  it('pure name list still compiles to enabled only (no inline key) — regression', () => {
    const compiled = compileAgentDefinition(defineAgent({ model: 'm', skills: ['a', 'b'] }))
    expect(compiled.skills).toEqual({ enabled: ['a', 'b'], autoInject: true })
    expect(compiled.skills).not.toHaveProperty('inline')
  })

  // Auto-wiring the `skill_read` tool happens at the RUNTIME layer (where @theokit/sdk is loaded), not
  // at compile time — the compile module stays free of a runtime SDK dependency. See
  // tests/integration/skill-read-autowire.test.ts.
})
