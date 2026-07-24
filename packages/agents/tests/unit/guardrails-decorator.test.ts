import { describe, it, expect } from 'vitest'
import { GuardrailsCapability } from '../../src/capability/agent-capabilities.js'
import { applyCapabilities } from '../../src/capability/capability.js'

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

describe('guardrails capability (M9)', () => {
  it('flows the declared guards into compiled.guardrails, in order', () => {
    const guards = [promptInjectionDetector(), customGuard]
    const compiled = applyCapabilities([new GuardrailsCapability(guards)])
    expect(compiled.guardrails).toHaveLength(2)
    expect(compiled.guardrails?.map((g) => g.name)).toEqual(['prompt-injection', 'custom'])
  })

  it('is absent when nothing declares guardrails', () => {
    expect(applyCapabilities([]).guardrails).toBeUndefined()
  })
})
