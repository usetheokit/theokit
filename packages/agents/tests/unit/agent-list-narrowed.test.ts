/**
 * M103 (agent-builder) — the `Agent.list` narrowing in the barrel is a TYPE change and must be a
 * ZERO-behaviour change. The compile-time half lives in `tests/type/agent-list-narrowed.test-d.ts`;
 * this is the runtime half, and it exists because a narrowing implemented as a WRAPPER (a new
 * function that forwards) would pass the type test identically while changing identity, `this`
 * binding and any future SDK method the barrel does not know about.
 *
 * The assertion is therefore identity, not equality: the exported value IS the SDK's `Agent`.
 */
import { describe, expect, it } from 'vitest'

import { Agent as AgentDoSdk } from '@theokit/sdk'

import { Agent } from '../../src/index.js'

describe('M103 — Agent.list narrowing', () => {
  it('re-exports the SDK Agent value itself, never a wrapper', () => {
    expect(Agent).toBe(AgentDoSdk)
  })

  it('keeps `list` as the SDK function, so runtime results are unchanged by construction', () => {
    expect(Agent.list).toBe(AgentDoSdk.list)
  })

  it('keeps every other static reachable and identical (MF-3)', () => {
    for (const membro of [
      'create',
      'getOrCreate',
      'get',
      'delete',
      'archive',
      'unarchive',
      'rename',
      'compact',
      'listRuns',
      'getRun',
    ] as const) {
      expect(Agent[membro], `Agent.${membro} disappeared from the narrowed re-export`).toBe(
        AgentDoSdk[membro],
      )
    }
  })
})
