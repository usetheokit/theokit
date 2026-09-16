/**
 * THEO.md > AGENTS.md > CLAUDE.md, first-wins, per directory level.
 *
 * The list was literal — `['AGENTS.md', 'AGENTS.local.md']` — so a repository written for Claude
 * Code brought nothing, and a `CLAUDE.md` sitting beside the code steered nothing. Someone adopting
 * this product from Claude Code started by re-creating instructions they had already written.
 *
 * FIRST-WINS is the decision, and it is a change of kind rather than of degree: the old list read
 * BOTH files it knew about at every level. Under first-wins a directory contributes exactly one
 * instruction file, so a repository that grows a `THEO.md` stops reading its `AGENTS.md` — which is
 * the point (one file steers, and which one is unambiguous) and is also the surprise, so it is
 * pinned here rather than left to be discovered.
 *
 * The `.local` companion runs its OWN chain rather than following the winner. If it followed,
 * adding a `THEO.md` would silently orphan an existing `AGENTS.local.md` — a file the operator
 * wrote, disabled by a file they added for an unrelated reason.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it, vi } from 'vitest'

import { loadAgentsMd } from '../../src/context/agents-md.js'

const roots: string[] = []
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'theocode-instr-'))
  roots.push(root)
  mkdirSync(join(root, '.git'), { recursive: true })
  for (const [name, body] of Object.entries(files)) writeFileSync(join(root, name), body)
  return root
}

const load = (root: string) => loadAgentsMd(root, vi.fn())

describe('the instruction file chain', () => {
  it.each(['THEO.md', 'AGENTS.md', 'CLAUDE.md'])('test_%s_is_read_when_it_is_the_only_one', (name) => {
    expect(load(project({ [name]: `steering from ${name}` }))).toContain(`steering from ${name}`)
  })

  it('test_THEO_wins_over_both_others', () => {
    const root = project({
      'THEO.md': 'FROM THEO',
      'AGENTS.md': 'FROM AGENTS',
      'CLAUDE.md': 'FROM CLAUDE',
    })

    const out = load(root)

    expect(out).toContain('FROM THEO')
    expect(out, 'AGENTS.md was read while THEO.md exists — this is additive, not first-wins').not.toContain('FROM AGENTS')
    expect(out).not.toContain('FROM CLAUDE')
  })

  it('test_AGENTS_wins_over_CLAUDE_when_there_is_no_THEO', () => {
    const out = load(project({ 'AGENTS.md': 'FROM AGENTS', 'CLAUDE.md': 'FROM CLAUDE' }))

    expect(out).toContain('FROM AGENTS')
    expect(out).not.toContain('FROM CLAUDE')
  })

  it('test_a_claude_code_repository_is_read_with_no_migration', () => {
    // The case that motivated this: someone arrives from Claude Code with only a CLAUDE.md.
    expect(load(project({ 'CLAUDE.md': 'FROM CLAUDE' }))).toContain('FROM CLAUDE')
  })

  it('test_the_local_companion_runs_its_own_chain', () => {
    // Adding a THEO.md must not orphan an AGENTS.local.md the operator wrote.
    const out = load(project({ 'THEO.md': 'FROM THEO', 'AGENTS.local.md': 'FROM AGENTS LOCAL' }))

    expect(out).toContain('FROM THEO')
    expect(out, 'a local file the operator wrote was dropped by an unrelated addition').toContain(
      'FROM AGENTS LOCAL',
    )
  })

  it('test_the_local_chain_is_also_first_wins', () => {
    const out = load(
      project({ 'THEO.local.md': 'FROM THEO LOCAL', 'CLAUDE.local.md': 'FROM CLAUDE LOCAL' }),
    )

    expect(out).toContain('FROM THEO LOCAL')
    expect(out).not.toContain('FROM CLAUDE LOCAL')
  })

  it('test_a_directory_with_none_of_them_contributes_nothing', () => {
    // Anti-vacuity: a loader that returned every file it found would satisfy the assertions above.
    expect(load(project({ 'README.md': 'NOT AN INSTRUCTION FILE' }))).not.toContain(
      'NOT AN INSTRUCTION FILE',
    )
  })
})
