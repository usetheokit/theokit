import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import {
  DelegationTimeoutError,
  withEphemeralAgent,
} from '../../src/bridge/delegation-lifecycle.js'
import { delegateBackground, delegateWithScoring } from '../../src/bridge/delegation-scoring.js'
import type { DelegationResult } from '../../src/bridge/delegation-types.js'

/**
 * M81 — the three gaps left in delegation.
 *
 * The execution engine is supplied and works; most of the ~770 LOC a consumer wrote around it is
 * policy. What was missing:
 *
 * - **a clock cap.** Budget is money only, and a delegation that HANGS burns clock, not dollars. So
 *   the consumer wrote its own timeout race with its own typed error.
 * - **disposal with an owner.** `delegate()` never creates disposable agents, so every site that
 *   does (a squad, an ephemeral reviewer) hand-writes acquire/dispose — and both files carried a
 *   bug-fix comment about `finally` semantics.
 * - **reach.** `delegateWithScoring` took a `SubAgentSpec` produced by the capability compiler, so a
 *   consumer holding an SDK `SubAgent` or `Squad` could not feed it. Which is why the scoring loop —
 *   the layer's highest-value piece — had ZERO adoption in a product that runs an explicit review pass.
 */

/**
 * A settled delegation.
 *
 * The field is `response`, not `text` — my first double invented `text`, and the `as unknown as`
 * cast hid it from the running suite while `tsc` caught it. Built from the real shape now, so the
 * double cannot drift from what a caller actually receives.
 */
const ok = (response: string): DelegationResult => ({
  response,
  toolCalls: [],
  cost: 0,
  tokens: 0,
})

describe('the clock cap is a different guard from the dollar cap', () => {
  it('test_a_delegation_past_timeoutMs_rejects_with_a_typed_error', async () => {
    const port = { run: () => new Promise<DelegationResult>(() => undefined) } // never settles
    await expect(
      delegateWithScoring(port, 'go', {
        scorer: () => ({ pass: true, score: 1, feedback: '' }),
        timeoutMs: 20,
      }),
    ).rejects.toBeInstanceOf(DelegationTimeoutError)
  })

  it('test_the_timeout_error_names_the_budget_it_exceeded', async () => {
    // "delegation timed out" sends an operator looking for a network fault. "exceeded its 20 ms
    // clock cap" sends them to the number they set.
    const port = { run: () => new Promise<DelegationResult>(() => undefined) }
    const error = await delegateWithScoring(port, 'go', {
      scorer: () => ({ pass: true, score: 1, feedback: '' }),
      timeoutMs: 20,
    }).then(
      () => undefined,
      (e: unknown) => e as Error,
    )
    expect(error?.message).toMatch(/20/)
  })

  it('test_a_delegation_INSIDE_the_cap_is_untouched', async () => {
    // The counter-proof. A cap that fires on everything is not a cap, it is an outage.
    const port = { run: () => Promise.resolve(ok('done')) }
    const scored = await delegateWithScoring(port, 'go', {
      scorer: () => ({ pass: true, score: 1, feedback: '' }),
      timeoutMs: 5_000,
    })
    expect(scored.result.response).toBe('done')
  })

  it('test_no_timeoutMs_means_no_clock_cap', async () => {
    // Additive by design: an existing caller that never asked for a clock cap must not acquire one.
    const port = { run: () => Promise.resolve(ok('done')) }
    await expect(
      delegateWithScoring(port, 'go', { scorer: () => ({ pass: true, score: 1, feedback: '' }) }),
    ).resolves.toBeDefined()
  })
})

describe('withEphemeralAgent — disposal that has an owner', () => {
  it('test_the_agent_is_disposed_after_the_body_resolves', async () => {
    const dispose = vi.fn()
    const result = await withEphemeralAgent(
      () => ({ agent: { id: 'a' }, dispose }),
      (agent) => Promise.resolve(`used ${agent.id}`),
    )
    expect(result).toBe('used a')
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('test_the_agent_is_disposed_when_the_body_THROWS', async () => {
    // The whole reason this exists in one place: both hand-written call sites carried a bug-fix
    // comment about `finally` semantics, which is what a leaked agent per failed run looks like.
    const dispose = vi.fn()
    await expect(
      withEphemeralAgent(
        () => ({ agent: { id: 'a' }, dispose }),
        () => Promise.reject(new Error('boom')),
      ),
    ).rejects.toThrow('boom')
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('test_a_failing_dispose_does_NOT_mask_the_body_result', async () => {
    // `Promise.allSettled` semantics, named by the DoD. A throwing cleanup that replaced the real
    // result would report a teardown error for a run that actually succeeded — and hide a run that
    // actually failed.
    const result = await withEphemeralAgent(
      () => ({
        agent: { id: 'a' },
        dispose: () => {
          throw new Error('dispose failed')
        },
      }),
      () => Promise.resolve('the real answer'),
    )
    expect(result).toBe('the real answer')
  })

  it('test_a_failing_dispose_does_NOT_mask_the_body_ERROR_either', async () => {
    await expect(
      withEphemeralAgent(
        () => ({
          agent: { id: 'a' },
          dispose: () => {
            throw new Error('dispose failed')
          },
        }),
        () => Promise.reject(new Error('the real failure')),
      ),
    ).rejects.toThrow('the real failure')
  })
})

describe('reach — the scoring loop accepts a PORT, not only a compiled spec', () => {
  it('test_an_SDK_shaped_object_with_run_satisfies_the_port', async () => {
    // The proof the DoD asks for. Anything exposing `run(message)` — an SDK `SubAgent`, a `Squad`,
    // a test double — feeds the loop. No trip through the capability compiler.
    const squadLike = {
      run: (message: string) => Promise.resolve(ok(`squad handled: ${message}`)),
    }
    const scored = await delegateWithScoring(squadLike, 'review this', {
      scorer: (r) => ({ pass: r.response.includes('squad'), score: 1, feedback: '' }),
    })
    expect(scored.result.response).toContain('squad handled')
    expect(scored.verdicts).toHaveLength(1)
  })

  it('test_the_port_is_re_run_with_feedback_until_the_scorer_passes', async () => {
    // The behaviour that makes the loop worth reaching: without it a port is just a call.
    const seen: string[] = []
    const port = {
      run: (message: string) => {
        seen.push(message)
        return Promise.resolve(ok(seen.length < 2 ? 'draft' : 'final'))
      },
    }
    const scored = await delegateWithScoring(port, 'write it', {
      scorer: (r) => ({ pass: r.response === 'final', score: 1, feedback: 'try again' }),
      maxRounds: 3,
    })
    expect(seen).toHaveLength(2)
    expect(scored.result.response).toBe('final')
  })

  it('test_delegateBackground_accepts_the_same_port', async () => {
    const port = { run: () => Promise.resolve(ok('bg')) }
    const background = delegateBackground(port, 'go')
    await expect(background.wait()).resolves.toMatchObject({ response: 'bg' })
  })
})

describe('listSubagentNames — one oracle over `.theokit/agents/*.md`', () => {
  it('test_it_is_exported_next_to_the_reader_it_selects_over', async () => {
    // The reach that matters: a product building an `/agents` command must find a name-shaped answer
    // in the same place as `discoverSubagents`, or it writes a second reader over the same directory.
    const barrel = (await import('../../src/index.js')) as Record<string, unknown>
    expect(barrel.listSubagentNames).toBeTypeOf('function')
    expect(barrel.discoverSubagents, 'the selector must sit beside its reader').toBeTypeOf(
      'function',
    )
  })

  it('test_a_project_with_no_subagents_lists_nothing_rather_than_failing', async () => {
    // The common case on a fresh project. `discoverSubagents` already treats an absent directory as
    // `{}`, and the selector must not turn that into an error.
    const { listSubagentNames } = await import('../../src/bridge/subagent-inventory.js')
    await expect(listSubagentNames(mkdtempSync(join(tmpdir(), 'no-agents-')))).resolves.toEqual([])
  })
})
