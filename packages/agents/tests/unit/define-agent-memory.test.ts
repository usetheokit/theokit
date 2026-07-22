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

  it('decorator_memory_no_longer_inert (real @Memory path, not fabricated)', async () => {
    // M49 review F8 — exercise the REAL decorator→walk→compiler→projection chain end-to-end
    // (pattern from memory-skills-mcp-decorators.test.ts).
    await import('reflect-metadata')
    const { Agent } = await import('../../src/decorators/agent.js')
    const { MainLoop } = await import('../../src/decorators/main-loop.js')
    const { Memory } = await import('../../src/decorators/memory.js')
    const { walkAgentMetadata } = await import('../../src/bridge/walk-agent-metadata.js')
    const { compileAgent } = await import('../../src/bridge/agent-compiler.js')

    @Agent({ name: 'mem-agent', route: '/mem' })
    @Memory({ provider: 'built-in', maxFacts: 100 })
    class MemAgent {
      @MainLoop()
      async run() {}
    }

    const compiled = compileAgent(walkAgentMetadata(MemAgent))
    expect(compiled.memory).toBeDefined()
    const warns: string[] = []
    const orig = process.stderr.write.bind(process.stderr)
    process.stderr.write = ((c: unknown) => {
      warns.push(String(c))
      return true
    }) as typeof process.stderr.write
    try {
      const { options, applied } = assembleM8CreateOptions(compiled)
      expect(options.memory).toEqual({ enabled: true })
      expect(applied).toContain('memory')
      // Unmapped decorator knobs are discarded LOUDLY (F8).
      expect(warns.join('')).toContain('maxFacts')
    } finally {
      process.stderr.write = orig
    }
  })

  it('no_memory_declared_projects_nothing', () => {
    const def = agent().model('openai/gpt-4o').build()
    const { options, applied } = assembleM8CreateOptions(compileAgentDefinition(def))
    expect(options.memory).toBeUndefined()
    expect(applied).not.toContain('memory')
  })
})
