/**
 * The variable is supplied, and never overwritten.
 *
 * Both halves matter and only one is obvious. Supplying it stops every turn being denied in a
 * repository that also uses Claude Code (usetheokit/theokit-sdk#522). NOT overwriting it is what
 * keeps this safe to run inside Claude Code itself, where the real value is already exported and
 * pointing at the actual project root — clobbering it would break the hooks this is meant to fix.
 */
import { describe, expect, it } from 'vitest'

import { installClaudeProjectDir } from '../../src/hooks/claude-project-dir.js'

describe('installClaudeProjectDir', () => {
  it('test_an_unset_variable_is_given_the_project_directory', () => {
    const env: Record<string, string | undefined> = {}
    expect(installClaudeProjectDir(env, '/repo')).toBe('/repo')
    expect(env.CLAUDE_PROJECT_DIR).toBe('/repo')
  })

  it('test_a_value_that_is_already_set_is_left_alone', () => {
    // Inside Claude Code the real value is exported and points at the true project root. A hook
    // borrowed from `.claude/` resolves against it correctly, and overwriting would break it.
    const env: Record<string, string | undefined> = { CLAUDE_PROJECT_DIR: '/real/root' }
    expect(installClaudeProjectDir(env, '/somewhere/else')).toBe('/real/root')
    expect(env.CLAUDE_PROJECT_DIR).toBe('/real/root')
  })

  it('test_a_blank_value_counts_as_unset', () => {
    // An exported-but-empty variable produces the same broken `/.claude/...` path as no variable at
    // all, so treating it as "already set" would preserve exactly the bug this fixes.
    const env: Record<string, string | undefined> = { CLAUDE_PROJECT_DIR: '   ' }
    expect(installClaudeProjectDir(env, '/repo')).toBe('/repo')
    expect(env.CLAUDE_PROJECT_DIR).toBe('/repo')
  })
})
