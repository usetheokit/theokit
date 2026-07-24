import { describe, expect, it, vi } from 'vitest'
import type { SubAgentSpec } from '../../src/bridge/agent-orchestrator.js'
import { ModelCapability } from '../../src/capability/capabilities.js'
import { applyCapabilities } from '../../src/capability/capability.js'

import { delegateBackground, delegateWithScoring } from '../../src/bridge/delegation-scoring.js'
import type { DelegationResult } from '../../src/bridge/delegation-types.js'

/**
 * M25 — background delegation + task-completion scoring. Both are THIN wrappers over the existing
 * M12 `delegate` (ADR 0038/0040): no new orchestration engine, no second loop, no new store. A
 * fake `delegateFn` is injected so the tests need no SubAgent class or LLM.
 */

function result(response: string): DelegationResult {
  return { response, toolCalls: [], cost: 0, tokens: 0 }
}

// The delegate function is mocked in every test here, so the spec is only an identity token; a
// minimal SubAgentSpec stands in for what used to be a decorated class.
const fakeSubAgent: SubAgentSpec = {
  name: 'fakeSubAgent',
  compiled: applyCapabilities([new ModelCapability('fake-model')]),
}

describe('M25 — delegateBackground', () => {
  it('does not block: the supervisor continues before the sub-agent finishes', async () => {
    let release: (r: DelegationResult) => void = () => {}
    const pending = new Promise<DelegationResult>((r) => {
      release = r
    })
    const delegateFn = vi.fn(() => pending)

    const handle = delegateBackground(fakeSubAgent, 'do the thing', { delegateFn })

    // The supervisor keeps working while the sub-agent is still running.
    expect(handle.settled()).toBe(false)
    const supervisorDidOtherWork = true
    expect(supervisorDidOtherWork).toBe(true)

    // Now the sub-agent finishes; the supervisor awaits the handle.
    release(result('done in background'))
    const r = await handle.wait()
    expect(r.response).toBe('done in background')
    expect(handle.settled()).toBe(true)
    expect(delegateFn).toHaveBeenCalledOnce()
  })

  it('marks settled on failure too (rejection is observable via wait())', async () => {
    const delegateFn = vi.fn(() => Promise.reject(new Error('sub-agent blew up')))
    const handle = delegateBackground(fakeSubAgent, 'x', { delegateFn })
    await expect(handle.wait()).rejects.toThrow('sub-agent blew up')
    expect(handle.settled()).toBe(true)
  })
})

describe('M25 — delegateWithScoring', () => {
  it('re-delegates with feedback when the scorer fails, then returns the passing result', async () => {
    const responses = ['first attempt (weak)', 'second attempt (good)']
    const delegateFn = vi.fn((_a: unknown, message: string) => {
      const idx = delegateFn.mock.calls.length - 1
      return Promise.resolve({ ...result(responses[idx]), _msg: message } as DelegationResult)
    })

    const scorer = vi.fn((r: DelegationResult) =>
      r.response.includes('good')
        ? { pass: true, score: 1 }
        : { pass: false, score: 0.2, feedback: 'be more specific' },
    )

    const out = await delegateWithScoring(fakeSubAgent, 'summarize', {
      scorer,
      maxRounds: 3,
      delegateFn,
    })

    expect(delegateFn).toHaveBeenCalledTimes(2)
    // The 2nd delegate call carried the scorer feedback.
    expect(delegateFn.mock.calls[1][1]).toContain('be more specific')
    expect(out.passed).toBe(true)
    expect(out.rounds).toBe(2)
    expect(out.result.response).toBe('second attempt (good)')
    expect(out.verdicts).toHaveLength(2)
  })

  it('stops at maxRounds and returns the last result with passed=false', async () => {
    const delegateFn = vi.fn(() => Promise.resolve(result('always weak')))
    const scorer = vi.fn(() => ({ pass: false, feedback: 'still weak' }))

    const out = await delegateWithScoring(fakeSubAgent, 'x', { scorer, maxRounds: 2, delegateFn })

    expect(delegateFn).toHaveBeenCalledTimes(2)
    expect(out.passed).toBe(false)
    expect(out.rounds).toBe(2)
    expect(out.result.response).toBe('always weak')
  })

  it('passes first try ⇒ one delegate call, no feedback loop', async () => {
    const delegateFn = vi.fn(() => Promise.resolve(result('perfect')))
    const scorer = vi.fn(() => ({ pass: true }))
    const out = await delegateWithScoring(fakeSubAgent, 'x', { scorer, delegateFn })
    expect(delegateFn).toHaveBeenCalledOnce()
    expect(out.passed).toBe(true)
    expect(out.rounds).toBe(1)
  })
})
