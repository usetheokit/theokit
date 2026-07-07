/**
 * M14 (theokit-ai-first) — HITL approvals on the `defineAgent` surface.
 *
 * Today `@HumanInTheLoop` gates tools only on the `@Agent` class surface. This adds
 * `defineAgent({ approvals: { <toolName>: opts } })`, which populates the SAME `compiled.hitl`
 * map the decorator path produces — so it reuses the ALREADY-PROVEN endpoint HITL wiring
 * (`agent-endpoint.ts` reads `compiled.hitl`). No new mount path.
 *
 * TDD RED-first.
 */
import type { CustomTool } from '@theokit/sdk'
import { describe, expect, it } from 'vitest'

import { compileAgentDefinition, defineAgent } from '../../src/bridge/define-agent.js'

const echoTool: CustomTool = {
  name: 'deploy',
  description: 'Deploy to prod',
  inputSchema: { type: 'object', properties: { env: { type: 'string' } } },
  handler: () => 'done',
}

describe('M14 — defineAgent({ approvals })', () => {
  it('populates compiled.hitl from the approvals map (same shape as the decorator path)', () => {
    const def = defineAgent({
      model: 'test',
      tools: [echoTool],
      approvals: { deploy: { question: 'Confirm deploy to prod?', timeout: 60_000, onTimeout: 'abort' } },
    })
    const compiled = compileAgentDefinition(def)
    expect(compiled.hitl).toBeInstanceOf(Map)
    expect(compiled.hitl?.get('deploy')).toEqual({
      question: 'Confirm deploy to prod?',
      timeout: 60_000,
      onTimeout: 'abort',
    })
  })

  it('leaves compiled.hitl undefined when no approvals are declared', () => {
    const compiled = compileAgentDefinition(defineAgent({ model: 'test', tools: [echoTool] }))
    expect(compiled.hitl).toBeUndefined()
  })

  it('fails fast when an approval references a tool that does not exist', () => {
    const def = defineAgent({
      model: 'test',
      tools: [echoTool],
      approvals: { nonexistent: { question: 'huh?' } },
    })
    expect(() => compileAgentDefinition(def)).toThrow(/nonexistent/)
  })
})
