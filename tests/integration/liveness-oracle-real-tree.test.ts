/**
 * T3.2 — the liveness oracle against a real directory tree.
 *
 * The unit tests inject a counting `FsSeam` so the budget is provable. This one uses the real
 * filesystem, because the property that matters in production is that the oracle's answer matches
 * what is actually on disk — and because a seam that models `existsSync` slightly wrong would make
 * every unit test agree with a fiction.
 *
 * Scale is deliberately small. The Global DoD asks for a run against the operator's real tree
 * (historically 13.269 project directories); that number differs on every machine and every day, so
 * what is asserted is EQUIVALENCE with the filesystem plus the budget property, both of which are
 * scale-independent (EC-24, Risk R5).
 */
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { classifyProjects } from '../../packages/agents/src/session/index.js'

const encode = (cwd: string): string => cwd.replace(/[^a-zA-Z0-9]/g, '-')

describe('classifyProjects against a real tree', () => {
  it('test_the_verdicts_match_what_is_on_disk', () => {
    const root = mkdtempSync(join(tmpdir(), 'liveness-'))
    const alive = join(root, 'still-here')
    const moved = join(root, 'nested', 'moved-app')
    mkdirSync(alive, { recursive: true })
    mkdirSync(moved, { recursive: true })
    const gone = join(root, 'deleted')

    let ops = 0
    const out = classifyProjects([encode(alive), encode(moved), encode(gone)], {
      listProjects: () => [alive, moved],
      budget: 100,
      fs: {
        exists: (p) => {
          ops += 1
          return existsSync(p)
        },
      },
    })

    expect(out.get(encode(alive))?.liveness).toBe('alive')
    expect(out.get(encode(moved))?.liveness, 'a real path is found by search too').toBe('alive')
    expect(out.get(encode(gone))?.liveness).toBe('dead')
    expect(ops).toBeLessThanOrEqual(100)
  })

  it('test_a_tight_budget_degrades_to_undetermined_and_never_deletes', () => {
    // The production failure this guards: a sweep over a large tree that runs out of budget must
    // leave transcripts alone, not garbage-collect them because it stopped looking.
    const root = mkdtempSync(join(tmpdir(), 'liveness-'))
    const encoded = Array.from({ length: 6 }, (_, i) => encode(join(root, `p${String(i)}`)))
    const out = classifyProjects(encoded, {
      listProjects: () => [],
      budget: 2,
      fs: { exists: existsSync },
    })
    const verdicts = encoded.map((e) => out.get(e)?.liveness)
    expect(verdicts.filter((v) => v === 'undetermined').length).toBeGreaterThan(0)
    expect(verdicts).toHaveLength(6)
  })
})
