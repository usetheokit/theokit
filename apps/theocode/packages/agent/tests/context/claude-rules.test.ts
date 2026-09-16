/**
 * #72 item 3 — `.claude/rules/` is read alongside our own.
 *
 * Someone arriving from Claude Code has rules written and none of them are read here, so adoption
 * begins by copying files between two directories that hold the same thing in the same format.
 *
 * ADDITIVE, not first-wins, and the difference from the instruction chain is deliberate. An
 * instruction file is ONE document steering the agent, so a second one silently shadowing the first
 * is the confusion `THEO.md > AGENTS.md > CLAUDE.md` exists to prevent. A rules DIRECTORY is a set:
 * Claude Code loads every `.md` under it, this product loads every `.md` under its own, and a
 * repository that has both meant both.
 *
 * Ours is walked FIRST because order is the caller's and ours is the local convention; with additive
 * loading that decides the order in the prompt rather than what gets read.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it, vi } from 'vitest'

import { loadRules, loadUserRules } from '../../src/context/rules.js'

const roots: string[] = []
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'theocode-crules-'))
  roots.push(root)
  for (const [rel, body] of Object.entries(files)) {
    const path = join(root, rel)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, body)
  }
  return root
}

describe('project rules', () => {
  it('test_a_claude_code_repository_has_its_rules_read', () => {
    const cwd = tree({ '.claude/rules/style.md': 'PREFER NAMED EXPORTS' })

    expect(loadRules(cwd, vi.fn()).text).toContain('PREFER NAMED EXPORTS')
  })

  it('test_our_own_directory_is_still_read', () => {
    const cwd = tree({ '.theokit/rules/style.md': 'FROM THEOKIT' })

    expect(loadRules(cwd, vi.fn()).text).toContain('FROM THEOKIT')
  })

  it('test_a_repository_with_both_gets_both', () => {
    // The set semantics. Neither shadows the other: a repository that has both meant both.
    const cwd = tree({
      '.theokit/rules/a.md': 'FROM THEOKIT',
      '.claude/rules/b.md': 'FROM CLAUDE',
    })

    const { text, count } = loadRules(cwd, vi.fn())

    expect(text).toContain('FROM THEOKIT')
    expect(text).toContain('FROM CLAUDE')
    expect(count).toBe(2)
  })

  it('test_a_repository_with_neither_loads_nothing', () => {
    // Anti-vacuity: a loader that returned everything it walked past would satisfy the cases above.
    expect(loadRules(tree({ 'README.md': 'NOT A RULE' }), vi.fn()).count).toBe(0)
  })
})

describe('user rules', () => {
  it('test_the_home_claude_directory_is_read_too', () => {
    // The operator's own rules, in the directory Claude Code put them in.
    const home = tree({ '.claude/rules/personal.md': 'FROM HOME CLAUDE' })

    expect(loadUserRules(home, vi.fn()).text).toContain('FROM HOME CLAUDE')
  })

  it('test_our_own_home_directory_is_still_read', () => {
    const home = tree({ '.theocode/rules/personal.md': 'FROM HOME THEOCODE' })

    expect(loadUserRules(home, vi.fn()).text).toContain('FROM HOME THEOCODE')
  })
})
