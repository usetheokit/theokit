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
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
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

    // Transcripts carry the recorded cwd — the authoritative answer. `gone` gets one too, which is
    // what lets it be proven dead rather than merely unfound.
    const projectsRoot = join(root, '.theokit', 'projects')
    for (const cwd of [alive, moved, gone]) {
      const dir = join(projectsRoot, encode(cwd))
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'a.jsonl'), `${JSON.stringify({ cwd })}\n`)
    }

    let ops = 0
    const out = classifyProjects([encode(alive), encode(moved), encode(gone)], {
      projectsRoot,
      candidatePaths: () => [alive, moved],
      budget: 200,
      fs: {
        // Three-valued on purpose: ENOENT is the only errno that means absence. Anything else is
        // `undefined`, because a stat we could not perform must never read as "not there" on the
        // path where the caller deletes (the consumer's B-020 scar).
        exists: (p) => {
          ops += 1
          try {
            return existsSync(p)
          } catch {
            return undefined
          }
        },
        listEntries: (d) => {
          ops += 1
          try {
            return readdirSync(d)
          } catch {
            return []
          }
        },
        firstLine: (f) => {
          ops += 1
          try {
            return readFileSync(f, 'utf8').split('\n', 1)[0] ?? ''
          } catch {
            return ''
          }
        },
      },
    })

    expect(out.get(encode(alive))?.liveness).toBe('alive')
    expect(out.get(encode(moved))?.liveness, 'resolved by its own recorded cwd').toBe('alive')
    expect(out.get(encode(gone))?.liveness).toBe('dead')
    expect(ops).toBeLessThanOrEqual(200)
  })

  it('test_a_tight_budget_degrades_to_undetermined_and_never_deletes', () => {
    // The production failure this guards: a sweep over a large tree that runs out of budget must
    // leave transcripts alone, not garbage-collect them because it stopped looking.
    const root = mkdtempSync(join(tmpdir(), 'liveness-'))
    const encoded = Array.from({ length: 6 }, (_, i) => encode(join(root, `p${String(i)}`)))
    const out = classifyProjects(encoded, {
      projectsRoot: join(root, '.theokit', 'projects'),
      candidatePaths: () => [],
      budget: 2,
      fs: {
        exists: existsSync,
        listEntries: (d) => {
          try {
            return readdirSync(d)
          } catch {
            return []
          }
        },
        firstLine: () => '',
      },
    })
    const verdicts = encoded.map((e) => out.get(e)?.liveness)
    expect(verdicts.filter((v) => v === 'undetermined').length).toBeGreaterThan(0)
    expect(verdicts).toHaveLength(6)
  })
})
