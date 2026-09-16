/**
 * Output styles — Claude Code's, read from Claude Code's directories.
 *
 * Format measured against `code.claude.com/docs/en/output-styles.md` on 2026-09-07, not inferred:
 * `.md` files under `~/.claude/output-styles/` and `<project>/.claude/output-styles/`; frontmatter
 * `name` (defaults to the filename), `description`, and `keep-coding-instructions` — a boolean whose
 * DEFAULT IS FALSE, so a style REPLACES the built-in coding instructions unless it opts in.
 *
 * That default is the arm most worth pinning. Getting it backwards makes every style a no-op with a
 * suffix: the built-in instructions stay, the operator sees their text appended, and nothing they
 * asked to remove is gone.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { loadOutputStyle, applyOutputStyle } from '../../src/context/output-styles.js'

let home: string
let project: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'theocode-style-home-'))
  project = mkdtempSync(join(tmpdir(), 'theocode-style-proj-'))
})
afterEach(() => {
  rmSync(home, { recursive: true, force: true })
  rmSync(project, { recursive: true, force: true })
})

function style(dir: string, file: string, body: string): void {
  mkdirSync(join(dir, '.claude', 'output-styles'), { recursive: true })
  writeFileSync(join(dir, '.claude', 'output-styles', file), body)
}

describe('finding a style', () => {
  it('test_it_reads_the_operators_own_root', () => {
    style(home, 'terse.md', '---\ndescription: short\n---\n\nBe terse.\n')
    expect(loadOutputStyle('terse', { home, project })?.instructions).toBe('Be terse.')
  })

  it('test_the_project_wins_a_name_collision', () => {
    // Their documented precedence, and this product's own rule for skills and roles: the project is
    // the more specific context.
    style(home, 'terse.md', '---\n---\n\nfrom home\n')
    style(project, 'terse.md', '---\n---\n\nfrom project\n')
    expect(loadOutputStyle('terse', { home, project })?.instructions).toBe('from project')
  })

  it('test_the_filename_is_the_name_when_frontmatter_does_not_give_one', () => {
    style(home, 'terse.md', 'Be terse.\n')
    expect(loadOutputStyle('terse', { home, project })?.name).toBe('terse')
  })

  it('test_a_frontmatter_name_overrides_the_filename', () => {
    style(home, 'anything.md', '---\nname: terse\n---\n\nBe terse.\n')
    expect(loadOutputStyle('terse', { home, project })?.instructions).toBe('Be terse.')
  })

  it('test_a_style_nobody_wrote_resolves_to_nothing_rather_than_throwing', () => {
    // The caller must be able to tell "no such style" from "a style with empty instructions", and a
    // missing directory is the ordinary case for anyone who has not made one.
    expect(loadOutputStyle('absent', { home, project })).toBeNull()
  })
})

describe('what a style does to the instructions', () => {
  const BUILT_IN = 'BUILT-IN CODING INSTRUCTIONS'

  it('test_by_default_it_REPLACES_the_built_in_instructions', () => {
    style(home, 'terse.md', '---\ndescription: short\n---\n\nBe terse.\n')
    const composed = applyOutputStyle(BUILT_IN, loadOutputStyle('terse', { home, project }))

    expect(composed).toBe('Be terse.')
    expect(composed, 'the built-in instructions survived a replacing style').not.toContain(BUILT_IN)
  })

  it('test_keep_coding_instructions_true_APPENDS_instead', () => {
    style(home, 'terse.md', '---\nkeep-coding-instructions: true\n---\n\nAlso be terse.\n')
    const composed = applyOutputStyle(BUILT_IN, loadOutputStyle('terse', { home, project }))

    expect(composed).toContain(BUILT_IN)
    expect(composed).toContain('Also be terse.')
  })

  it('test_no_style_leaves_the_built_in_instructions_exactly_as_they_were', () => {
    // Anti-vacuity floor: without this arm, a function that always returned the built-in text would
    // satisfy the append case, and one that always returned the style would satisfy the replace case.
    expect(applyOutputStyle(BUILT_IN, null)).toBe(BUILT_IN)
  })

  it('test_the_frontmatter_itself_never_reaches_the_prompt', () => {
    style(home, 'terse.md', '---\ndescription: a description nobody should be told\n---\n\nBe terse.\n')
    expect(applyOutputStyle(BUILT_IN, loadOutputStyle('terse', { home, project }))).not.toContain(
      'nobody should be told',
    )
  })
})
