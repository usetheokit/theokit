/**
 * The safety rules of `sessions gc --all-projects`, driven through the on-disk entry points.
 *
 * These cases used to drive the product's own planner through injected seams (floor, keepLast quota,
 * pointer and registry guards, fail-open, id namespace, writer lease). The planner is the framework's
 * now, so the same behaviours are asserted against a real tree: the wiring a user gets, with the
 * registry and the writer lease the only fakes.
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { encodeProjectDir, transcriptPath } from '@theokit/agents/persistence'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  registry: new Map<string, { agentId: string; archived?: boolean; lastModified?: number }[]>(),
  failRegistry: new Set<string>(),
  writers: new Set<string>(),
}))

vi.mock('../../../src/session/agent-list.js', async (original) => ({
  ...(await original<typeof import('../../../src/session/agent-list.js')>()),
  listAgents: (cwd: string) => {
    if (state.failRegistry.has(cwd)) return Promise.reject(new Error('registry down'))
    return Promise.resolve(state.registry.get(cwd) ?? [])
  },
}))
vi.mock('@theokit/agents/persistence', async (original) => ({
  ...(await original<typeof import('@theokit/agents/persistence')>()),
  sessionHasWriter: (path: string) => state.writers.has(path),
}))

import { planAllProjectsOnDisk, runAllProjectsOnDisk } from '../../../src/session/gc/filesystem.js'
import { claimRoot } from '../../../src/session/gc/root-ownership.js'

const DAY = 86_400_000
let base: string
let root: string
let live: string
let other: string

beforeEach(() => {
  state.registry.clear()
  state.failRegistry.clear()
  state.writers.clear()
  base = mkdtempSync(join(tmpdir(), 'theocode-gc-guards-'))
  root = join(base, 'projects')
  mkdirSync(root)
  claimRoot(root)
  live = join(base, 'live-a')
  other = join(base, 'live-b')
  mkdirSync(live)
  mkdirSync(other)
})
afterEach(() => {
  chmodSync(base, 0o700)
  rmSync(base, { recursive: true, force: true })
})

function age(path: string, days: number): void {
  const t = new Date(Date.now() - days * DAY)
  utimesSync(path, t, t)
}

function put(cwd: string, name: string, days: number): string {
  const dir = join(root, encodeProjectDir(cwd))
  mkdirSync(dir, { recursive: true })
  const file = join(dir, name)
  writeFileSync(file, `${JSON.stringify({ cwd })}\n`)
  age(file, days)
  return file
}

/** A transcript named the way the SDK names the session `id` of `cwd`. */
function session(cwd: string, id: string, days: number): string {
  const file = transcriptPath(base, cwd, id)
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, `${JSON.stringify({ cwd })}\n`)
  age(file, days)
  return file
}

const opts = (extra = {}) => ({ projectsRoot: root, keepLast: 1, maxAgeDays: 7, ...extra })
const targets = (plan: { candidates: { target: string }[] }): string[] =>
  plan.candidates.map((c) => c.target)

describe('the collection floor', () => {
  it('refuses a window below the floor, and says it was refused', async () => {
    for (const maxAgeDays of [0, -1]) {
      await expect(planAllProjectsOnDisk(opts({ maxAgeDays }))).rejects.toThrow(/maxAgeDays/)
    }
  })

  it('accepts the floor itself', async () => {
    await expect(planAllProjectsOnDisk(opts({ maxAgeDays: 1 }))).resolves.toBeDefined()
  })

  it('never plans a transcript inside the window, and plans one past it', async () => {
    put(live, 'newest.jsonl', 0.1)
    const inside = put(live, 'inside.jsonl', 3)
    const past = put(live, 'past.jsonl', 30)
    const plan = await planAllProjectsOnDisk(opts({ keepLast: 1 }))
    expect(targets(plan)).toContain(past)
    expect(targets(plan)).not.toContain(inside)
  })
})

describe('keepLast', () => {
  it('keeps the newest transcripts however old they are', async () => {
    const a = put(live, 'a.jsonl', 100)
    const b = put(live, 'b.jsonl', 200)
    const c = put(live, 'c.jsonl', 300)
    const plan = await planAllProjectsOnDisk(opts({ keepLast: 2 }))
    expect(targets(plan)).toEqual([c])
    expect(targets(plan)).not.toContain(a)
    expect(targets(plan)).not.toContain(b)
  })

  it('protects the newest of a DEAD project and collects beyond the slice', async () => {
    const gone = join(base, 'gone')
    const newest = put(gone, 'new.jsonl', 50)
    const old = put(gone, 'old.jsonl', 100)
    const plan = await planAllProjectsOnDisk(opts())
    expect(targets(plan)).toEqual([old])
    expect(targets(plan)).not.toContain(newest)
  })

  it('an unstattable transcript is never collected and keeps its project whole', async () => {
    const fresh = put(live, 'fresh.jsonl', 1)
    const old = put(live, 'old.jsonl', 100)
    const dangling = join(root, encodeProjectDir(live), 'ghost.jsonl')
    symlinkSync(join(base, 'nowhere'), dangling)
    const plan = await planAllProjectsOnDisk(opts())
    // Its owner cannot be established, so nothing in the project is collected (stricter than before).
    expect(plan.candidates).toEqual([])
    expect(existsSync(old) && existsSync(fresh)).toBe(true)
    expect(plan.kept).toContain(encodeProjectDir(live))
    expect(targets(plan)).not.toContain(dangling)
  })
})

describe('the pointer', () => {
  function point(cwd: string, id: string): void {
    mkdirSync(join(cwd, '.theokit'), { recursive: true })
    writeFileSync(join(cwd, '.theokit', 'tui-session'), `${id}\n`)
  }

  it('is collectable without it, and protected with it, however stale', async () => {
    put(live, 'newest.jsonl', 1)
    const stale = session(live, 'sess-1', 100)
    expect(targets(await planAllProjectsOnDisk(opts()))).toContain(stale)
    point(live, 'sess-1')
    expect(targets(await planAllProjectsOnDisk(opts()))).not.toContain(stale)
  })

  it('a pointer that cannot be read skips only its own project and names the pointer', async () => {
    put(live, 'newest.jsonl', 1)
    const brokenOld = put(live, 'old.jsonl', 100)
    mkdirSync(join(live, '.theokit', 'tui-session'), { recursive: true }) // EISDIR on read
    put(other, 'newest.jsonl', 1)
    const healthyOld = put(other, 'old.jsonl', 100)
    const plan = await planAllProjectsOnDisk(opts())
    expect(targets(plan)).toContain(healthyOld)
    expect(targets(plan)).not.toContain(brokenOld)
    expect(plan.errors.join('\n')).toMatch(/pointer read failed/)
    expect(plan.errors.join('\n')).not.toMatch(/registry read failed/)
  })

  it('a registry that cannot be read is named as the registry', async () => {
    put(live, 'newest.jsonl', 1)
    const old = put(live, 'old.jsonl', 100)
    state.failRegistry.add(live)
    const plan = await planAllProjectsOnDisk(opts())
    expect(targets(plan)).not.toContain(old)
    expect(plan.errors.join('\n')).toMatch(/registry read failed/)
  })

  it('apply refuses a transcript whose session became the pointer after the plan', async () => {
    put(live, 'newest.jsonl', 1)
    const stale = session(live, 'sess-2', 100)
    const plan = await planAllProjectsOnDisk(opts())
    expect(targets(plan)).toContain(stale)
    point(live, 'sess-2')
    const result = await runAllProjectsOnDisk(plan, opts({ apply: true }))
    expect(existsSync(stale)).toBe(true)
    expect(result.errors.join('\n')).toMatch(/refused/)
  })
})

describe('the registry', () => {
  it('keeps a registered session however old, collects it when unlisted, ignores an archived listing', async () => {
    put(live, 'newest.jsonl', 1)
    const stale = session(live, 'sess-r', 100)
    expect(targets(await planAllProjectsOnDisk(opts()))).toContain(stale)
    state.registry.set(live, [{ agentId: 'sess-r' }])
    expect(targets(await planAllProjectsOnDisk(opts()))).not.toContain(stale)
    state.registry.set(live, [{ agentId: 'sess-r', archived: true }])
    const archived = await planAllProjectsOnDisk(opts())
    expect(targets(archived)).toContain(stale)
    // A registered transcript is removed through its SESSION id, which only the plan can pair.
    expect(archived.framework?.candidates.find((c) => c.target === stale)?.sessionId).toBe('sess-r')
  })

  it('collects an old registry entry with no transcript, never an undated one or one whose transcript exists', async () => {
    put(live, 'newest.jsonl', 1)
    session(live, 'on-disk', 1)
    state.registry.set(live, [
      { agentId: 'on-disk', lastModified: Date.now() - 100 * DAY },
      { agentId: 'orphan', lastModified: Date.now() - 100 * DAY },
      { agentId: 'undated' },
    ])
    const plan = await planAllProjectsOnDisk(opts())
    expect(plan.candidates.filter((c) => c.kind === 'registry').map((c) => c.target)).toEqual([
      'orphan',
    ])
  })

  it('a listing that returns a cursor is refused, a drained one returns its items', async () => {
    const { CursorNotDrainedError, listAgents: realListAgents } = await vi.importActual<
      typeof import('../../../src/session/agent-list.js')
    >('../../../src/session/agent-list.js')
    await expect(
      realListAgents('/p', () => Promise.resolve({ items: [], nextCursor: 'page-2' })),
    ).rejects.toThrow(CursorNotDrainedError)
    await expect(
      realListAgents('/p', () => Promise.resolve({ items: [{ agentId: 'a1' }] })),
    ).resolves.toEqual([{ agentId: 'a1' }])
  })
})

describe('artifacts and writers', () => {
  it('a transcript with a live writer is not planned, at plan time and at apply time', async () => {
    put(live, 'newest.jsonl', 1)
    const writing = put(live, 'writing.jsonl', 100)
    const idle = put(live, 'idle.jsonl', 100)
    state.writers.add(writing)
    const plan = await planAllProjectsOnDisk(opts())
    expect(targets(plan)).toEqual([idle])
    state.writers.add(idle) // gained a writer after the plan
    const result = await runAllProjectsOnDisk(plan, opts({ apply: true }))
    expect(existsSync(idle)).toBe(true)
    expect(result.removed).not.toContain(idle)
    expect(result.errors.join('\n')).toMatch(/refused/)
  })

  it('a lock beside a live transcript is kept, an orphan one is collected', async () => {
    put(live, 'newest.jsonl', 1)
    put(live, 'sibling.jsonl', 100)
    const dir = join(root, encodeProjectDir(live))
    const kept = join(dir, 'sibling.jsonl.writer.lock')
    const orphan = join(dir, 'gone.jsonl.writer.lock')
    for (const f of [kept, orphan]) {
      writeFileSync(f, '')
      age(f, 100)
    }
    const plan = await planAllProjectsOnDisk(opts({ keepLast: 2 }))
    expect(targets(plan)).toContain(orphan)
    expect(targets(plan)).not.toContain(kept)
  })

  it('only the SDK’s own temp files are collectable', async () => {
    put(live, 'newest.jsonl', 1)
    const dir = join(root, encodeProjectDir(live))
    const foreign = join(dir, 'notes.txt.tmp')
    const sdk = join(dir, 'state.json.1234.0123456789abcdef.tmp')
    for (const f of [foreign, sdk]) {
      writeFileSync(f, '')
      age(f, 100)
    }
    const plan = await planAllProjectsOnDisk(opts())
    expect(targets(plan)).toEqual([sdk])
  })

  it('a file that vanished between plan and apply is not an error', async () => {
    put(live, 'newest.jsonl', 1)
    const old = put(live, 'old.jsonl', 100)
    const plan = await planAllProjectsOnDisk(opts())
    rmSync(old)
    const result = await runAllProjectsOnDisk(plan, opts({ apply: true }))
    expect(result.errors).toEqual([])
  })
})

describe('a run that could not look does not report an empty result', () => {
  it('a project root that cannot be listed is an error, not "nothing to collect"', async () => {
    const file = join(base, 'a-file')
    writeFileSync(file, 'x')
    const plan = await planAllProjectsOnDisk({ projectsRoot: file, keepLast: 1, maxAgeDays: 7 })
    expect(plan.candidates).toEqual([])
    expect(plan.errors.length).toBeGreaterThan(0)
  })

  it('a project that cannot be classified is kept whole', async () => {
    const dir = join(root, 'mystery')
    mkdirSync(dir)
    writeFileSync(join(dir, 'x.jsonl'), '{}\n')
    age(join(dir, 'x.jsonl'), 100)
    const plan = await planAllProjectsOnDisk(opts())
    expect(plan.candidates).toEqual([])
    expect(plan.kept).toContain('mystery')
  })
})
