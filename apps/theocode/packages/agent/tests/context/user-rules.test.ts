/**
 * The user layer of `rules/` — usetheoai-lab/TheoCode#65, second half.
 *
 * Same asymmetry the instruction layer already carries, for the same reason: a rule that belongs to
 * the PERSON ("never touch files under infra/ without asking") had nowhere to live but a project
 * `.theokit/rules/`, which commits it into a shared repository.
 *
 * The path is `~/.theocode/rules/` rather than `~/.theokit/rules/`, and the difference is deliberate:
 * `.theokit/` in a PROJECT is the framework's directory, but what this product owns in the
 * operator's home is `.theocode/` — that is where `config.toml`, `auth.json` and `AGENTS.md` already
 * are. A user rule is the operator's file, not the framework's.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { loadUserRules } from '../../src/context/rules.js'

let home: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'theocode-urules-'))
})
afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

function writeRule(name: string, text: string): void {
  const dir = join(home, '.theocode', 'rules')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, name), text)
}

describe('loadUserRules', () => {
  it('test_no_rules_directory_is_the_common_case', () => {
    expect(loadUserRules(home)).toEqual({ text: '', count: 0, read: 0, chars: 0, kept: 0, truncated: false })
  })

  it('test_a_user_rule_is_read', () => {
    writeRule('style.md', 'Prefer explicit over clever.')
    const { text, count } = loadUserRules(home)
    expect(text).toContain('Prefer explicit over clever.')
    expect(count).toBe(1)
  })

  it('test_a_scoped_user_rule_keeps_its_scope_line', () => {
    // The scope prefix is this product's prompt, and it has to survive the user layer — a rule that
    // silently loses `paths:` would apply everywhere instead of where the operator scoped it.
    writeRule('infra.md', '---\npaths:\n  - "infra/**"\n---\nAsk before touching infra.')
    expect(loadUserRules(home).text).toContain('Applies ONLY to files matching')
  })

  it('test_only_markdown_is_read', () => {
    // Anti-vacuity: the directory is in the operator's home, where unrelated files accumulate.
    writeRule('notes.txt', 'not a rule')
    expect(loadUserRules(home)).toEqual({ text: '', count: 0, read: 0, chars: 0, kept: 0, truncated: false })
  })
})
