import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { Agent } from '../../src/decorators/agent.js'
import { MainLoop } from '../../src/decorators/main-loop.js'
import { Skills, getSkillsConfig } from '../../src/decorators/skills.js'
import { walkAgentMetadata } from '../../src/bridge/walk-agent-metadata.js'
import { compileAgent } from '../../src/bridge/agent-compiler.js'
import { compileSkills } from '../../src/bridge/compile-skills.js'

describe('compileSkills (M8-3)', () => {
  it('test_skills_include_compiles_to_enabled', () => {
    expect(compileSkills({ include: ['a', 'b'] })).toEqual({
      enabled: ['a', 'b'],
      autoInject: true,
    })
  })

  it('test_skills_autodiscover_omits_enabled', () => {
    const r = compileSkills({ include: [], autoDiscover: true })
    expect(r).toEqual({ autoInject: true })
    expect('enabled' in r).toBe(false)
  })

  it('test_skills_options_shape_unchanged', () => {
    @Agent({ name: 's', route: '/s' })
    @Skills({ include: ['x'], autoDiscover: false })
    class A {
      @MainLoop()
      async run() {}
    }
    const cfg = getSkillsConfig(A)!
    expect(Object.keys(cfg).sort((a, b) => a.localeCompare(b))).toEqual(['autoDiscover', 'include'])
  })

  it('test_compileAgent_emits_skillssettings', () => {
    @Agent({ name: 'sup', route: '/sup' })
    @Skills(['x'])
    class SupportAgent {
      @MainLoop()
      async run() {}
    }
    const walk = walkAgentMetadata(SupportAgent)
    const compiled = compileAgent(walk)
    expect(compiled.skills).toEqual({ enabled: ['x'], autoInject: true })
  })
})
