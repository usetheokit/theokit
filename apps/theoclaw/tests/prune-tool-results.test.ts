import { describe, expect, it } from 'vitest'

import { DEFAULT_PRUNE_TOOL_RESULT_ROUNDS, pruneToolResultRounds, untrustedContentSendOptions } from '../src/agent/untrusted-content.js'

describe('pruneToolResults send option (OC-54)', () => {
  it('defaults the round count and honours the environment', () => {
    expect(pruneToolResultRounds({})).toBe(DEFAULT_PRUNE_TOOL_RESULT_ROUNDS)
    expect(pruneToolResultRounds({ THEOCLAW_PRUNE_TOOL_RESULT_ROUNDS: '2' })).toBe(2)
    expect(pruneToolResultRounds({ THEOCLAW_PRUNE_TOOL_RESULT_ROUNDS: 'x' })).toBe(DEFAULT_PRUNE_TOOL_RESULT_ROUNDS)
    expect(pruneToolResultRounds({ THEOCLAW_PRUNE_TOOL_RESULT_ROUNDS: '0' })).toBe(DEFAULT_PRUNE_TOOL_RESULT_ROUNDS)
  })

  it('rides on every send options object', () => {
    expect(untrustedContentSendOptions().pruneToolResults).toEqual({ olderThanRounds: DEFAULT_PRUNE_TOOL_RESULT_ROUNDS })
  })
})
