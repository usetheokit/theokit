import type { SDKAgent } from '@theokit/sdk'
import type { WorkflowRun } from '@theokit/sdk/workflow'
import { describe, expect, it, vi } from 'vitest'

import { createDigestWorkflow, DigestInput, toPoints } from '../src/workflows/digest-workflow.js'

/** An agent whose every turn finishes with `draft`: all `agentStep` reads of an agent is `send` and `wait`. */
function draftingAgent(draft: string): { readonly agent: SDKAgent; readonly send: ReturnType<typeof vi.fn> } {
  const send = vi.fn(async () => ({ wait: async () => ({ status: 'finished', result: draft }) }))
  return { agent: { agentId: 'agent-digest-test', send } as unknown as SDKAgent, send }
}

function completedSteps(run: WorkflowRun): number {
  return run.stepResults.filter((step) => step.status === 'completed').length
}

describe('toPoints', () => {
  it('turns dash lines into points', () => {
    expect(toPoints('- a\n- b').points).toEqual(['a', 'b'])
  })

  it('ignores a dash with no space and keeps an indented dash line', () => {
    expect(toPoints('-x\n  - y').points).toEqual(['y'])
  })
})

describe('DigestInput', () => {
  it('accepts 20000 characters and refuses 20001', () => {
    expect(DigestInput.safeParse({ text: 'x'.repeat(20000) }).success).toBe(true)
    expect(DigestInput.safeParse({ text: 'x'.repeat(20001) }).success).toBe(false)
  })
})

describe('the digest workflow', () => {
  it('completes two steps on a valid draft', async () => {
    const run = await createDigestWorkflow(draftingAgent('- first point\n- second point').agent).run({ text: 'some text' })
    expect(run.status).toBe('completed')
    expect(completedSteps(run)).toBe(2)
    expect(run.output).toEqual({ points: ['first point', 'second point'] })
  })

  it('fails a draft with no dash line', async () => {
    const run = await createDigestWorkflow(draftingAgent('The text says several things in prose.').agent).run({ text: 'some text' })
    expect(run.status).toBe('failed')
  })

  it('fails a draft with eleven points', async () => {
    const draft = Array.from({ length: 11 }, (_, index) => `- point ${index}`).join('\n')
    const run = await createDigestWorkflow(draftingAgent(draft).agent).run({ text: 'some text' })
    expect(run.status).toBe('failed')
  })

  it('completes on a draft of exactly ten points', async () => {
    const draft = Array.from({ length: 10 }, (_, index) => `- point ${index}`).join('\n')
    const run = await createDigestWorkflow(draftingAgent(draft).agent).run({ text: 'some text' })
    expect(run.status).toBe('completed')
    expect(run.output?.points).toHaveLength(10)
  })

  it('refuses an empty text before any step runs', async () => {
    const { agent, send } = draftingAgent('- a point')
    expect(DigestInput.safeParse({ text: '' }).success).toBe(false)
    const run = await createDigestWorkflow(agent).run({ text: '' })
    expect(run.status).toBe('failed')
    expect(send).not.toHaveBeenCalled()
  })

  it('fails the run when the draft agent errors', async () => {
    const send = vi.fn(async () => ({ wait: async () => ({ status: 'error', error: new Error('provider unavailable') }) }))
    const run = await createDigestWorkflow({ agentId: 'agent-digest-test', send } as unknown as SDKAgent).run({ text: 'some text' })
    expect(run.status).toBe('failed')
    expect(run.error?.message).toContain('provider unavailable')
  })
})
