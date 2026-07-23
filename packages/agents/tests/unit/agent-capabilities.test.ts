import 'reflect-metadata'
import { describe, expect, it } from 'vitest'

import { compileAgent } from '../../src/bridge/agent-compiler.js'
import { walkAgentMetadata } from '../../src/bridge/walk-agent-metadata.js'
import {
  AgentConfigCapability,
  checkpoint,
  contextWindow,
  guardrails,
  humanInTheLoop,
  MainLoopCapability,
  mcpServers,
  memory,
  plugins,
  projectContext,
  runContext,
  settingSources,
  skillsResolver,
  subAgents,
} from '../../src/capability/agent-capabilities.js'
import { applyCapabilities } from '../../src/capability/capability.js'
import { ConfigurationError } from '../../src/capability/capabilities.js'
import { Agent as DecoratorAgent } from '../../src/decorators/agent.js'
import { MainLoop } from '../../src/decorators/main-loop.js'

/**
 * M53 § A — one capability per waist-bound decorator. The oracle for the pass-through ones is that
 * they place the value the decorator pipeline places; the two that carry behavior are checked
 * against the DECORATOR path itself, because behavior is where a migration actually breaks.
 */
describe('waist-bound capabilities (M53 § A)', () => {
  it('each pure-data capability places its field, and only its field', () => {
    const cases = [
      [memory({ provider: 'mem0' } as never), 'memory'],
      [contextWindow({ maxTokens: 100 } as never), 'context'],
      [projectContext({ enabled: true } as never), 'projectContext'],
      [mcpServers({ gh: { type: 'stdio', command: 'x' } } as never), 'mcpServers'],
      [guardrails([{ name: 'g' }] as never), 'guardrails'],
      [checkpoint({ storage: 'filesystem' } as never), 'checkpoint'],
      [humanInTheLoop(new Map([['tb.tool', {}]]) as never), 'hitl'],
      [subAgents({ child: {} } as never), 'agents'],
      [settingSources(['project'] as never), 'settingSources'],
      [plugins([{ name: 'p' }] as never), 'plugins'],
      [runContext({ k: 1 } as never), 'runContext'],
      [skillsResolver((() => []) as never), 'skillsResolver'],
    ] as const

    for (const [capability, field] of cases) {
      const draft = applyCapabilities([capability])
      expect(draft[field]).toBeDefined()
      expect(draft.provenance).toEqual([{ capability: capability.name, contributed: [field] }])
    }
  })

  it('@MainLoop WINS over @Agent on maxIterations/timeoutMs — the decorator path says so', () => {
    @DecoratorAgent({ name: 'p', route: '/p', model: 'm', maxIterations: 3, timeoutMs: 300 })
    class Decorated {
      @MainLoop({ maxIterations: 9, timeoutMs: 900 })
      async run(): Promise<void> {}
    }
    const viaDecorators = compileAgent(walkAgentMetadata(Decorated))
    expect([viaDecorators.maxIterations, viaDecorators.timeoutMs]).toEqual([9, 900])

    // Same precedence through capabilities, and it must NOT depend on declaration order.
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
