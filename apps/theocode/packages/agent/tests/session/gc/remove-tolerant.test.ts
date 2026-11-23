/**
 * The idempotent-delete rule both GC apply phases share, pinned at the framework's apply phase.
 *
 * The 2026-09-10 architecture review measured this business rule implemented twice — per-session
 * and all-projects — with the same semantics and the same `target: message` error shape consumers
 * parse. The rule now has one implementation, in `runProjectsGC`; these tests lock it there, so a
 * change to it (tolerating another code, changing the shape) turns one suite red.
 */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { runAllProjectsOnDisk } from '../../../src/session/gc/filesystem.js'
import { claimRoot } from '../../../src/session/gc/root-ownership.js'

const bases: string[] = []
afterEach(() => {
  for (const b of bases.splice(0)) {
    try {
      chmodSync(join(b, 'projects', 'p'), 0o700)
    } catch {
      // not created by this case
    }
    rmSync(b, { recursive: true, force: true })
  }
})

function scratch(): { root: string; dir: string; plan: (target: string) => never } {
  const base = mkdtempSync(join(tmpdir(), 'theocode-gc-tolerant-'))
  bases.push(base)
  const root = join(base, 'projects')
  const dir = join(root, 'p')
  mkdirSync(dir, { recursive: true })
  claimRoot(root)
  const plan = (target: string) =>
    ({
      candidates: [],
      kept: [],
      touchedProjects: [],
      liveCwds: [],
      totalByKind: {},
      errors: [],
      framework: {
        projectsRoot: root,
        candidates: [{ project: 'p', kind: 'transcript', target, ageDays: 90 }],
        kept: [],
        touchedProjects: ['p'],
        liveCwds: [],
        countByKind: { transcript: 1, 'writer-lock': 0, 'lock-directory': 0, temp: 0, registry: 0 },
        errors: [],
      },
    }) as never
  return { root, dir, plan }
}

describe('removal tolerates a vanished file', () => {
  it('a_successful_delete_is_recorded_as_removed', async () => {
    const { root, dir, plan } = scratch()
    const file = join(dir, 'old.jsonl')
    writeFileSync(file, '{}\n')

    const result = await runAllProjectsOnDisk(plan(file), { apply: true, projectsRoot: root })

    // The emptied project directory is removed with its last transcript.
    expect(result.removed).toEqual([file, dir])
    expect(result.errors).toEqual([])
    expect(existsSync(file)).toBe(false)
  })

  it('enoent_counts_as_removed_because_gone_is_what_removal_means', async () => {
    const { root, dir, plan } = scratch()
    const file = join(dir, 'vanished.jsonl')

    const result = await runAllProjectsOnDisk(plan(file), { apply: true, projectsRoot: root })

    expect(result.errors).toEqual([])
  })

  it('any_other_error_is_collected_as_id_colon_message_and_does_not_throw', async () => {
    const { root, dir, plan } = scratch()
    const file = join(dir, 'locked.jsonl')
    writeFileSync(file, '{}\n')
    chmodSync(dir, 0o500)

    const result = await runAllProjectsOnDisk(plan(file), { apply: true, projectsRoot: root })

    expect(result.removed).toEqual([])
    // The `target: message` shape is a contract: callers parse it.
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.startsWith(`${file}: `)).toBe(true)
    expect(existsSync(file)).toBe(true)
  })
})
