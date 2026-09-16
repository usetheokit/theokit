/**
 * B-072 — the subagent set is discoverable without guessing a name.
 *
 * The listing MUST resolve the way `config-commands.ts` resolves, or it becomes a second source of
 * truth that drifts from the router — a listing promising a subagent the router cannot find is
 * worse than no listing.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { listSubagents, subagentDirs, subagentPath } from '../../src/commands/subagent-inventory.js'

let cwd: string

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'theocode-subagents-'))
})
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true })
})

const ours = (): string => join(cwd, '.theokit', 'agents')

function writeAgent(name: string): void {
  mkdirSync(ours(), { recursive: true })
  writeFileSync(join(ours(), `${name}.md`), '# agent\n')
}

describe('B-072 — listSubagents', () => {
  it('test_lists_the_agents_on_disk_sorted', () => {
    writeAgent('reviewer')
    writeAgent('analyst')
    expect(listSubagents(cwd)).toEqual(['analyst', 'reviewer'])
  })

  it('test_resolves_where_the_router_resolves', () => {
    // The router resolves through `subagentPath`, over the directories `subagentDirs` names, in that
    // order. Pinning both here is what keeps the listing and the router from drifting — and pinning
    // the ORDER is what makes ours win when a name exists in both.
    expect(subagentDirs(cwd)).toEqual([join(cwd, '.theokit', 'agents'), join(cwd, '.claude', 'agents')])

    writeAgent('reviewer')
    expect(subagentPath(cwd, 'reviewer')).toBe(join(ours(), 'reviewer.md'))
    expect(subagentPath(cwd, 'absent')).toBeUndefined()
  })

  it('test_ignores_files_that_are_not_agents', () => {
    writeAgent('reviewer')
    writeFileSync(join(ours(), 'README.txt'), 'x')
    writeFileSync(join(ours(), '.md'), 'x')
    expect(listSubagents(cwd)).toEqual(['reviewer'])
  })

  it('test_a_project_with_no_subagents_is_empty_not_an_error', () => {
    // The normal case. Throwing here would turn "this project defines none" into a failure at
    // someone who only opened a listing.
    expect(listSubagents(cwd)).toEqual([])
  })
})
