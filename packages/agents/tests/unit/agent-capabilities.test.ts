import { describe, expect, it } from 'vitest'

import {
  AgentConfigCapability,
  CheckpointCapability,
  ContextWindowCapability,
  GuardrailsCapability,
  HumanInTheLoopCapability,
  MainLoopCapability,
  McpServersCapability,
  MemoryCapability,
  PluginsCapability,
  ProjectContextCapability,
  RunContextCapability,
  SettingSourcesCapability,
  SkillsResolverCapability,
  SubAgentsCapability,
} from '../../src/capability/agent-capabilities.js'
import { applyCapabilities } from '../../src/capability/capability.js'
import { ConfigurationError } from '../../src/errors.js'

/**
 * M53 § A — one capability per waist-bound decorator. The oracle for the pass-through ones is that
 * they place the value the decorator pipeline places; the two that carry behavior are checked
 * against the DECORATOR path itself, because behavior is where a migration actually breaks.
 */
describe('waist-bound capabilities (M53 § A)', () => {
  it('each pure-data capability places its field, and only its field', () => {
    const cases = [
      [new MemoryCapability({ provider: 'mem0' } as never), 'memory'],
      [new ContextWindowCapability({ maxTokens: 100 } as never), 'context'],
      [new ProjectContextCapability({ enabled: true } as never), 'projectContext'],
      [new McpServersCapability({ gh: { type: 'stdio', command: 'x' } } as never), 'mcpServers'],
      [new GuardrailsCapability([{ name: 'g' }] as never), 'guardrails'],
      [new CheckpointCapability({ storage: 'filesystem' } as never), 'checkpoint'],
      [new HumanInTheLoopCapability(new Map([['tb.tool', {}]]) as never), 'hitl'],
      [new SubAgentsCapability({ child: {} } as never), 'agents'],
      [new SettingSourcesCapability(['project'] as never), 'settingSources'],
      [new PluginsCapability([{ name: 'p' }] as never), 'plugins'],
      [new RunContextCapability({ k: 1 } as never), 'runContext'],
      [new SkillsResolverCapability((() => []) as never), 'skillsResolver'],
    ] as const

    for (const [capability, field] of cases) {
      const draft = applyCapabilities([capability])
      expect(draft[field]).toBeDefined()
      expect(draft.provenance).toEqual([{ capability: capability.name, contributed: [field] }])
    }
  })

  it('main-loop WINS over agent-config on maxIterations/timeoutMs, order-independent', () => {
    // Preserves the precedence the decorator compiler had (`mainLoop.x ?? agentConfig.x`): when both
    // declare the loop knobs, main-loop wins — and it must NOT depend on declaration order.
    const agentCfg = new AgentConfigCapability({ maxIterations: 3, timeoutMs: 300 })
    const mainLoop = new MainLoopCapability({ maxIterations: 9, timeoutMs: 900 })
    for (const order of [
      [agentCfg, mainLoop],
      [mainLoop, agentCfg],
    ]) {
      const draft = applyCapabilities(order)
      expect([draft.maxIterations, draft.timeoutMs]).toEqual([9, 900])
    }
  })

  it('@Agent scalars survive when @MainLoop declares nothing', () => {
    const draft = applyCapabilities([
      new AgentConfigCapability({
        systemPrompt: 'you are x',
        parseThinkTags: true,
        stripToolDialect: true,
        recoverLeakedToolCalls: true,
        stream: false,
        maxIterations: 4,
        timeoutMs: 400,
      }),
      new MainLoopCapability({}),
    ])
    expect(draft).toMatchObject({
      systemPrompt: 'you are x',
      parseThinkTags: true,
      stripToolDialect: true,
      recoverLeakedToolCalls: true,
      stream: false,
      maxIterations: 4,
      timeoutMs: 400,
    })
  })

  it('agent-config validates at the boundary (a config file can hand it anything)', () => {
    expect(() => new AgentConfigCapability(null as never)).toThrow(ConfigurationError)
    expect(() => new AgentConfigCapability({ maxIterations: 0 })).toThrow(/maxIterations/)
    expect(() => new AgentConfigCapability({ timeoutMs: -1 })).toThrow(/timeoutMs/)
  })
})
