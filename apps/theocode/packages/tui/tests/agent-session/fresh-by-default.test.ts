// A launch does not inherit the last conversation unless it asks to.
//
// `resumeOnStartup` was `existsSync(sessionPointer)` and nothing ever removed that file, so a
// directory used once resumed on EVERY later launch, forever, with no flag to opt out — the only
// escape was `/new` after the screen was already up. Measured 2026-09-15: a restart meant to clear
// a session whose context was over budget (167.3k of a 121.6k window) came back carrying it, and
// the only notice was one parenthetical in the greeting.
//
// Both reference CLIs start fresh and resume on request. The pointer is still WRITTEN on every
// launch, because that is what makes `--continue` able to find the session next time.

import { describe, expect, it } from 'vitest'

import { createTuiSession } from '../../src/agent-session/tui-session.js'
import { resumeRequested } from '../../src/agent-session/resume-request.js'

const POINTER = '/nonexistent/.theokit/tui-session'

describe('resumeRequested', () => {
  it('is false for a launch with no arguments — the default is a fresh session', () => {
    expect(resumeRequested([])).toBe(false)
    expect(resumeRequested(['node', 'main.tsx'])).toBe(false)
  })

  it('is true for --continue and for -c', () => {
    expect(resumeRequested(['node', 'main.tsx', '--continue'])).toBe(true)
    expect(resumeRequested(['node', 'main.tsx', '-c'])).toBe(true)
  })

  it('does not match a flag that merely starts with the same letters', () => {
    expect(resumeRequested(['--continuous'])).toBe(false)
    expect(resumeRequested(['--config'])).toBe(false)
  })
})

describe('createTuiSession — resume is opt-in', () => {
  it('ignores the pointer when resume is not requested', () => {
    let read = false
    const s = createTuiSession({
      cwd: '/tmp',
      sessionPointer: POINTER,
      resume: false,
      loadSession: (_p, fresh) => {
        read = true
        return fresh()
      },
    })
    expect(read).toBe(false)
    expect(s.session()).toMatch(/^tui-/)
  })

  it('reads the pointer when resume IS requested', () => {
    const s = createTuiSession({
      cwd: '/tmp',
      sessionPointer: POINTER,
      resume: true,
      loadSession: () => 'tui-from-pointer',
    })
    expect(s.session()).toBe('tui-from-pointer')
  })

  it('two fresh launches do not share a session id', () => {
    const mk = () =>
      createTuiSession({ cwd: '/tmp', sessionPointer: POINTER, resume: false }).session()
    expect(mk()).not.toBe(mk())
  })
})
