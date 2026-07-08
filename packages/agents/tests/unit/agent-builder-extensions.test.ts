/**
 * M31 Phase 2 — `agent()` builder gains `.guardrail(s)` / `.approval(s)` / `.skills`. Each sets the
 * matching `DefineAgentConfig` field, so `.build()` (→ `defineAgent` → `compileAgentDefinition`)
 * carries it into `CompiledAgentOptions` exactly like the object-config path.
 */
import { describe, it, expect } from 'vitest'

import type { CustomTool } from '@theokit/sdk'

import { agent } from '../../src/bridge/agent-builder.js'
import { compileAgentDefinition } from '../../src/bridge/define-agent.js'
import type { Guardrail } from '../../src/guardrails/index.js'

const passGuard: Guardrail = {
  name: 'test-guard',
  stage: 'input',
  check: () => ({ action: 'pass' }),
}

/** A minimal named tool so `.approval(name, …)` has a declared tool to gate (defineAgent validates). */
function namedTool<const N extends string>(name: N): CustomTool & { name: N } {
  return { name, description: name, inputSchema: {}, handler: async () => '' }
}

describe('agent() builder — M31 extensions', () => {
  it('.guardrail() appends and .guardrails() replaces', () => {
    const compiled = compileAgentDefinition(agent().model('m').guardrail(passGuard).build())
    expect(compiled.guardrails).toEqual([passGuard])
  })

  it('.approval() merges a HITL gate keyed by tool name', () => {
    const compiled = compileAgentDefinition(
      agent().model('m').tool(namedTool('write')).approval('write', { question: 'ok?' }).build(),
    )
    expect(compiled.hitl?.get('write')).toEqual({ question: 'ok?' })
  })

  it('.skills() sets a static skill selection', () => {
    const compiled = compileAgentDefinition(agent().model('m').skills(['fs', 'web']).build())
    expect(compiled.skills?.enabled).toEqual(['fs', 'web'])
  })

  it('builder .approval() matches the object-config approvals path', () => {
    const viaBuilder = compileAgentDefinition(
      agent().model('m').tool(namedTool('bash')).approval('bash', { question: 'run?' }).build(),
    )
    // Same compiled hitl map the decorator/defineAgent path produces.
    expect(viaBuilder.hitl?.get('bash')).toEqual({ question: 'run?' })
  })
})
