/**
 * #72 item 3 — a subagent declared under `.claude/agents/` is listed and routable.
 *
 * The SDK already DISCOVERS it: its filebase returns both directories
 * (`[join(cwd, THEOKIT_DIR_LITERAL), join(cwd, CLAUDE_DIR_NAME)]`), and a skill declared only under
 * `.claude/skills/` was measured working end to end on 2026-09-04. So the agent could already be
 * delegated to while this product's listing said it did not exist.
 *
 * BOTH SIDES MOVE TOGETHER, and that is the constraint rather than a nicety. `subagentDir` exists
 * because the listing and the router must not be two sources of truth — B-072's own words: "a
 * listing derived independently is a second source of truth, and the two drift". Widening the
 * listing alone would recreate exactly that, pointing at the other directory.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { listSubagents, subagentPath } from '../../src/commands/subagent-inventory.js'

const roots: string[] = []
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

function project(files: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'theocode-subag-'))
  roots.push(root)
  for (const rel of files) {
    const path = join(root, rel)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, '---\nname: x\n---\nbody\n')
  }
  return root
}

describe('subagents under .claude/', () => {
  it('test_one_declared_only_under_claude_is_listed', () => {
    expect(listSubagents(project(['.claude/agents/prober.md']))).toEqual(['prober'])
  })

  it('test_our_own_directory_still_works', () => {
    expect(listSubagents(project(['.theokit/agents/native.md']))).toEqual(['native'])
  })

  it('test_both_directories_are_listed_once_each', () => {
    expect(listSubagents(project(['.theokit/agents/a.md', '.claude/agents/b.md']))).toEqual(['a', 'b'])
  })

  it('test_the_same_name_in_both_is_listed_once', () => {
    // A repository that keeps the file in both places has ONE subagent, not two with the same name.
    expect(listSubagents(project(['.theokit/agents/dup.md', '.claude/agents/dup.md']))).toEqual(['dup'])
  })

  it('test_the_router_resolves_what_the_listing_shows', () => {
    // The constraint. A listing the router cannot follow is the drift B-072 exists to prevent, and
    // widening one without the other would point it at the other directory.
    const cwd = project(['.claude/agents/prober.md'])

    expect(subagentPath(cwd, 'prober')).toBeDefined()
  })

  it('test_the_router_refuses_a_name_that_is_in_neither', () => {
    // Anti-vacuity: a resolver that returned a path for anything would satisfy the case above.
    expect(subagentPath(project([]), 'absent')).toBeUndefined()
  })
})
