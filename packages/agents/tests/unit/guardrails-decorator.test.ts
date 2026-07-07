import 'reflect-metadata'
import { describe, it, expect } from 'vitest'

import { Agent } from '../../src/decorators/agent.js'
import { Guardrails, getGuardrailsConfig } from '../../src/decorators/guardrails.js'
import { MainLoop } from '../../src/decorators/main-loop.js'
import { compileAgent } from '../../src/bridge/agent-compiler.js'
import { walkAgentMetadata } from '../../src/bridge/walk-agent-metadata.js'
import { promptInjectionDetector } from '../../src/guardrails/index.js'
import type { Guardrail } from '../../src/guardrails/index.js'

/**
 * M9 — `@Guardrails([...])` gives the `@Agent` CLASS path the same guardrail capability the
 * functional `defineAgent({ guardrails })` path already has. The declared guards must compile into
 * `compiled.guardrails` (so `AgentRunner` applies them identically at the framework boundary).
 */

const customGuard: Guardrail = {
  name: 'custom',
  checkInput: () => ({ action: 'allow' }),
}

describe('@Guardrails decorator (M9)', () => {
  it('stores the guardrails as class metadata', () => {
    @Agent({ name: 'a', route: '/a' })
    @Guardrails([customGuard])
    class A {
      @MainLoop()
      loop(): void {}
    }
    expect(getGuardrailsConfig(A)).toEqual([customGuard])
  })

  it('flows the declared guards into compiled.guardrails', () => {
    const guards = [promptInjectionDetector(), customGuard]

    @Agent({ name: 'guarded', route: '/guarded' })
    @Guardrails(guards)
    class Guarded {
      @MainLoop()
      loop(): void {}
    }

    const walk = walkAgentMetadata(Guarded)
    expect(walk.guardrails).toEqual(guards)

    const compiled = compileAgent(walkAgentMetadata(Guarded))
    expect(compiled.guardrails).toHaveLength(2)
    expect(compiled.guardrails?.map((g) => g.name)).toEqual(['prompt-injection', 'custom'])
  })

  it('is absent when the class declares no @Guardrails (backward-compatible)', () => {
    @Agent({ name: 'plain', route: '/plain' })
    class Plain {
      @MainLoop()
      loop(): void {}
    }
    expect(getGuardrailsConfig(Plain)).toBeUndefined()
    expect(compileAgent(walkAgentMetadata(Plain)).guardrails).toBeUndefined()
  })
})
