/**
 * #70 — `/new` clears the continuation, because the screen would otherwise lie twice.
 *
 * `use-screen-state.ts` documented the pair as "`/resume` sets it, `/new` clears it". Only the first
 * half was true. Found when the resumed HISTORY started being drawn: after `/resume` then `/new`, the
 * greeting still announced a continuation, and it took a session-id change to drop the turns rather
 * than the command the user actually typed.
 *
 * `/clear` shares the branch and the same reasoning: both mean "this is a fresh conversation".
 */
import { describe, expect, it, vi } from 'vitest'

import { interpretCommand } from '../../src/commands/interpret-command.js'
import type { CommandCapabilities } from '../../src/commands/command-capabilities.js'

function run(kind: 'new' | 'clear' | 'toggleHelp'): boolean[] {
  const seen: boolean[] = []
  const cap = {
    agent: { reset: vi.fn() },
    SESSION: { attachImages: vi.fn() },
    backtrack: { setSeed: vi.fn() },
    goalAbort: { current: null },
    stdout: undefined,
    resetSession: vi.fn(),
    setToast: vi.fn(),
    setShowHelp: vi.fn(),
    setShowUsage: vi.fn(),
    setClearEpoch: vi.fn(),
    setEffort: vi.fn(),
    setGoalRun: vi.fn(),
    setGoalFeed: vi.fn(),
    setResumed: (v: unknown) => seen.push(v as boolean),
  } as unknown as CommandCapabilities

  interpretCommand({ kind } as never, '', cap)
  return seen
}

describe('#70 — a fresh conversation stops claiming to be a continuation', () => {
  it('test_new_clears_the_resumed_flag', () => {
    expect(run('new'), 'the greeting still says the session was resumed').toEqual([false])
  })

  it('test_clear_clears_it_too', () => {
    expect(run('clear')).toEqual([false])
  })

  it('test_an_unrelated_command_leaves_it_alone', () => {
    // Anti-vacuity: a handler that cleared on everything would satisfy both cases above and would
    // also wipe the history mid-session.
    expect(run('toggleHelp')).toEqual([])
  })
})
