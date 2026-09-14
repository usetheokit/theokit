/**
 * B-079 + B-080 — which decomposition the judge reads.
 *
 * `GoalOptions.subgoals` is documented "subgoals fed to the judge prompt" and is supplied by the
 * CALLER. Measured 2026-09-14: `packages/agents/src` produces it in **0** files, against a control of
 * 2 for `GoalOptions`. So the agent was marked against a breakdown somebody else wrote, and a wrong
 * breakdown was charged to the agent as failure.
 *
 * **The reviewer decided the precedence on 2026-09-14: the AGENT's decomposition wins.** A
 * caller-supplied `subgoals` is a starting value, never a verdict — which is exactly what removes the
 * defect. Precedence decided by argument order would be the same defect with an accidental cause,
 * so it is a function with a name and a test that fails when inverted.
 */
import { describe, expect, it } from 'vitest'

import { resolveDecomposition } from '../../src/loop/decomposition.js'

describe('which decomposition the judge reads', () => {
  it('the judge reads the agent decomposition when the caller supplied none', () => {
    expect(resolveDecomposition(undefined, ['migrate the reader', 'delete the shim'])).toEqual([
      'migrate the reader',
      'delete the shim',
    ])
  })

  it('the agent decomposition overrides a caller-supplied subgoals', () => {
    // Fails if the precedence is inverted — which is the whole assertion. A test that merely
    // checked "something came back" would pass under either rule.
    expect(resolveDecomposition(['what the caller guessed'], ['what the agent declared'])).toEqual([
      'what the agent declared',
    ])
  })

  it('a caller subgoals survives when the agent declares nothing', () => {
    expect(resolveDecomposition(['the caller list'], [])).toEqual(['the caller list'])
  })

  it('an agent that declares nothing leaves the goal loop unchanged', () => {
    // FR-007 as an identity: with neither source, the option is absent rather than an empty array.
    // `[]` and `undefined` are different instructions to a judge — one says "no subgoals", the other
    // says "nothing was specified".
    expect(resolveDecomposition(undefined, [])).toBeUndefined()
  })

  it('an empty caller list is preserved rather than silently dropped', () => {
    // A caller who passes `[]` said something, and it is not the same as saying nothing.
    expect(resolveDecomposition([], [])).toEqual([])
  })
})
