import { describe, expect, it } from 'vitest'
import { agent } from '../../src/index.js'
import { compileAgentDefinition } from '../../src/bridge/define-agent.js'
import { assembleM8CreateOptions } from '../../src/bridge/sdk-adapter-create-options.js'

/**
 * M49 (agent-builder) — the fluent builder's `.memory()` must reach `Agent.create({ memory })`.
 * Before this slice the compiled `memory` field existed on the decorator path but was NEVER
 * projected by `assembleM8CreateOptions` (same class as the #89 inert-@MCP bug), and the fluent
 * builder had no memory surface at all — the SDK's whole memory subsystem was unreachable from
 * the framework.
 */
describe('builder .memory() → Agent.create projection', () => {
  it('builder_memory_reaches_create_options', () => {
    const def = agent()
      .model('openai/gpt-4o')
      .memory({ enabled: true, autoInject: true })
      .build()
    const compiled = compileAgentDefinition(def)
    const { options, applied } = assembleM8CreateOptions(compiled)
    expect(options.memory).toEqual({ enabled: true, autoInject: true })
    expect(applied).toContain('memory')
  })

  it('decorator_memory_no_longer_inert', () => {
    // The decorator shape ({provider, scope, …}) has no `enabled` — declaring @Memory() means the
    // author WANTS memory, so the projection normalizes it to the SDK's `{enabled: true}`.
    const def = agent().model('openai/gpt-4o').build()
    const compiled = { ...compileAgentDefinition(def), memory: { provider: 'built-in' as const } }
    const { options, applied } = assembleM8CreateOptions(compiled)
    expect(options.memory).toEqual({ enabled: true })
    expect(applied).toContain('memory')
  })

  it('no_memory_declared_projects_nothing', () => {
    const def = agent().model('openai/gpt-4o').build()
    const { options, applied } = assembleM8CreateOptions(compileAgentDefinition(def))
    expect(options.memory).toBeUndefined()
    expect(applied).not.toContain('memory')
  })
})
