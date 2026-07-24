import 'reflect-metadata'
import { describe, expect, it } from 'vitest'

import { compileAgent } from '../../src/bridge/agent-compiler.js'
import { walkAgentMetadata } from '../../src/bridge/walk-agent-metadata.js'
import { Agent } from '../../src/decorators/agent.js'
import { MainLoop } from '../../src/decorators/main-loop.js'
import {
  AgentConfigCapability,
  MainLoopCapability,
} from '../../src/capability/agent-capabilities.js'
import { applyCapabilities } from '../../src/capability/capability.js'
import { ModelCapability } from '../../src/capability/capabilities.js'

/**
 * M53 § D — the repoint oracle.
 *
 * ~46 of the 51 decorator-importing test files never assert on metadata: they decorate a class only
 * to obtain a `CompiledAgentOptions` via `compileAgent(walkAgentMetadata(Cls))`. Repointing them
 * means swapping that FIXTURE for `applyCapabilities([...])` — which is only sound if the two
 * produce the same waist for the same declaration. This proves that for the shapes the suite
 * actually uses, so the mechanical edit is backed by evidence rather than by inspection.
 */
describe('decorator fixture ≡ capability fixture (repoint oracle)', () => {
  const waistOf = (o: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(Object.entries(o).filter(([k, v]) => k !== 'provenance' && v !== undefined))

  it('the bare shape every test uses: @Agent + @MainLoop', () => {
    @Agent({ name: 'plain', route: '/plain', model: 'openai/gpt-5.4' })
    class PlainAgent {
      @MainLoop()
      async run(): Promise<void> {}
    }

    expect(waistOf(applyCapabilities([new ModelCapability('openai/gpt-5.4')]))).toEqual(
      waistOf(compileAgent(walkAgentMetadata(PlainAgent)) as unknown as Record<string, unknown>),
    )
  })

  it('the scalar-carrying shape: every @Agent knob the suite sets', () => {
    @Agent({
      name: 'rich',
      route: '/rich',
      model: 'openai/gpt-5.4',
      systemPrompt: 'sys',
      parseThinkTags: true,
      stripToolDialect: true,
      recoverLeakedToolCalls: true,
      stream: false,
      maxIterations: 5,
      timeoutMs: 500,
    })
    class RichAgent {
      @MainLoop()
      async run(): Promise<void> {}
    }

    const viaCapabilities = applyCapabilities([
      new ModelCapability('openai/gpt-5.4'),
      new AgentConfigCapability({
        systemPrompt: 'sys',
        parseThinkTags: true,
        stripToolDialect: true,
        recoverLeakedToolCalls: true,
        stream: false,
        maxIterations: 5,
        timeoutMs: 500,
      }),
    ])
    expect(waistOf(viaCapabilities)).toEqual(
      waistOf(compileAgent(walkAgentMetadata(RichAgent)) as unknown as Record<string, unknown>),
    )
  })

  it('the loop-knob shape: @MainLoop overriding @Agent', () => {
    @Agent({ name: 'lp', route: '/lp', model: 'm', maxIterations: 2, timeoutMs: 200 })
    class LoopAgent {
      @MainLoop({ maxIterations: 8, timeoutMs: 800 })
      async run(): Promise<void> {}
    }

    const viaCapabilities = applyCapabilities([
      new ModelCapability('m'),
      new AgentConfigCapability({ maxIterations: 2, timeoutMs: 200 }),
      new MainLoopCapability({ maxIterations: 8, timeoutMs: 800 }),
    ])
    expect(waistOf(viaCapabilities)).toEqual(
      waistOf(compileAgent(walkAgentMetadata(LoopAgent)) as unknown as Record<string, unknown>),
    )
  })
})
