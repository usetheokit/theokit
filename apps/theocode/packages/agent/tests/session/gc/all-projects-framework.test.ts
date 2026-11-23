/**
 * `sessions gc --all-projects` on a real tree, through `planProjectsGC` / `runProjectsGC`.
 *
 * What is ours and is asserted here: the kind names in `totalByKind`, the
 * keep-last-only rule for a dead project, the product's own ownership marker, and the plan -> apply
 * hand-off. The safety rules themselves are the framework's and are tested there.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { encodeProjectDir } from '@theokit/agents/persistence'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { planAllProjectsOnDisk, runAllProjectsOnDisk } from '../../../src/session/gc/filesystem.js'
import { claimRoot } from '../../../src/session/gc/root-ownership.js'

const DAY = 86_400_000
let base: string
let root: string
let live: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'theocode-gc-fw-'))
  root = join(base, 'projects')
  mkdirSync(root)
  claimRoot(root)
  live = join(base, 'live-cwd')
  mkdirSync(live)
})
afterEach(() => rmSync(base, { recursive: true, force: true }))

function transcript(cwd: string, name: string, ageDays: number): string {
  const dir = join(root, encodeProjectDir(cwd))
  mkdirSync(dir, { recursive: true })
  const file = join(dir, name)
  writeFileSync(file, `${JSON.stringify({ cwd })}\n`)
  const t = new Date(Date.now() - ageDays * DAY)
  utimesSync(file, t, t)
  return file
}

const options = (extra = {}) => ({ projectsRoot: root, keepLast: 1, maxAgeDays: 7, ...extra })

describe('all-projects collection through the framework', () => {
  it('plans a live project without a declared cwd list, with this product’s kind names', async () => {
    transcript(live, 'new.jsonl', 1)
    const old = transcript(live, 'old.jsonl', 100)
    const dir = join(root, encodeProjectDir(live))
    const lock = join(dir, 'gone.jsonl.writer.lock')
    const tmp = join(dir, 'state.json.1234.0123456789abcdef.tmp')
    for (const f of [lock, tmp]) {
      writeFileSync(f, '')
      const t = new Date(Date.now() - 100 * DAY)
      utimesSync(f, t, t)
    }
    const plan = await planAllProjectsOnDisk(options())
    expect(plan.errors).toEqual([])
    expect(plan.candidates.map((c) => c.target).sort()).toEqual([old, lock, tmp].sort())
    expect(plan.totalByKind).toEqual({
      transcript: 1,
      'lock-file': 1,
      'lock-directory': 0,
      tmp: 1,
      registry: 0,
    })
  })

  it('protects the session the last-session pointer names', async () => {
    transcript(live, 'new.jsonl', 1)
    const pinned = transcript(live, 'pinned.jsonl', 100)
    // The pointer holds a session id; its transcript is named from it, so use the real mapping.
    const { transcriptPath } = await import('@theokit/agents/persistence')
    const named = transcriptPath(root, live, 'sess-1')
    mkdirSync(join(named, '..'), { recursive: true })
    writeFileSync(named, `${JSON.stringify({ cwd: live })}\n`)
    const t = new Date(Date.now() - 100 * DAY)
    utimesSync(named, t, t)
    const { sessionPointerPath } = await import('@theokit/agents/session')
    mkdirSync(join(sessionPointerPath(live, root), '..'), { recursive: true })
    writeFileSync(sessionPointerPath(live, root), 'sess-1\n')
    const plan = await planAllProjectsOnDisk({ ...options(), projectsRoot: join(base, 'projects') })
    const targets = plan.candidates.map((c) => c.target)
    expect(targets).toContain(pinned)
    expect(targets).not.toContain(named)
  })

  it('applies only keepLast to a dead project and removes what the plan listed', async () => {
    const gone = join(base, 'removed-cwd')
    transcript(gone, 'new.jsonl', 1)
    const old = transcript(gone, 'old.jsonl', 100)
    const plan = await planAllProjectsOnDisk(options())
    expect(plan.candidates.map((c) => c.target)).toEqual([old])
    const dry = await runAllProjectsOnDisk(plan, options())
    expect(dry.dryRun).toBe(true)
    expect(existsSync(old)).toBe(true)
    const done = await runAllProjectsOnDisk(plan, options({ apply: true }))
    expect(done.errors).toEqual([])
    expect(existsSync(old)).toBe(false)
  })

  it('refuses a root that carries another product’s marker', async () => {
    rmSync(join(base, '.theocode-collector.json'))
    writeFileSync(
      join(base, '.theocode-collector.json'),
      JSON.stringify({ product: 'x', version: 1 }),
    )
    transcript(live, 'new.jsonl', 1)
    transcript(live, 'old.jsonl', 100)
    const plan = await planAllProjectsOnDisk(options())
    expect(plan.candidates).toEqual([])
    expect(plan.errors[0]).toContain('will not delete inside it')
  })

  it('refuses a keepLast below the framework floor', async () => {
    await expect(planAllProjectsOnDisk(options({ keepLast: 0 }))).rejects.toThrow(
      /`keepLast` must be at least 1, received 0/,
    )
  })
})
