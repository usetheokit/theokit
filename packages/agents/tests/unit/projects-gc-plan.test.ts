import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { encodeProjectDir, legacyTranscriptPath, transcriptPath } from '@theokit/sdk/persistence'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { GCFloorError, planProjectsGC, type ProjectsGCFs } from '../../src/session/index.js'
import type { LivenessVerdict } from '../../src/session/liveness-oracle.js'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 10, 18)

let root: string
let projects: string
const CWD = '/work/app'
const NAME = encodeProjectDir(CWD)

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'projects-gc-'))
  projects = join(root, 'projects')
  mkdirSync(join(projects, NAME), { recursive: true })
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

function put(project: string, name: string, ageDays: number, dir = false): string {
  const path = join(projects, project, name)
  mkdirSync(join(projects, project), { recursive: true })
  if (dir) mkdirSync(path)
  else writeFileSync(path, '{}\n')
  const t = (NOW - ageDays * DAY) / 1000
  utimesSync(path, t, t)
  return path
}

function transcript(id: string, ageDays: number): string {
  const path = transcriptPath(root, CWD, id)
  writeFileSync(path, JSON.stringify({ sessionId: id, cwd: CWD }) + '\n')
  const t = (NOW - ageDays * DAY) / 1000
  utimesSync(path, t, t)
  return path
}

const alive =
  (cwd = CWD) =>
  (): Map<string, LivenessVerdict> =>
    new Map([[NAME, { liveness: 'alive', reason: 'test', cwd }]])

function plan(extra: Partial<Parameters<typeof planProjectsGC>[0]> = {}) {
  return planProjectsGC({
    projectsRoot: projects,
    keepLast: 1,
    maxAgeDays: 7,
    now: NOW,
    classify: alive(),
    candidateCwds: () => [CWD],
    candidateCwdsComplete: true,
    listRegistry: () => Promise.resolve([]),
    ...extra,
  })
}

describe('planProjectsGC', () => {
  it('an undetermined project is kept whole', async () => {
    transcript('old', 100)
    transcript('older', 200)
    put(NAME, 'x.jsonl.writer.lock', 100)
    const result = await plan({
      classify: () => new Map([[NAME, { liveness: 'undetermined', reason: 'no' }]]),
    })
    expect(result.candidates).toEqual([])
    expect(result.kept.some((k) => k.project === NAME)).toBe(true)
    expect(result.touchedProjects).toEqual([])
  })

  it('the newest keepLast transcripts and the pointer session are never candidates', async () => {
    transcript('new', 1)
    transcript('mid', 50)
    const pointed = transcript('pointed', 300)
    transcript('gone', 400)
    writeFileSync(join(projects, NAME, 'last-session'), 'pointed')
    const result = await plan({
      keepLast: 2,
    })
    const targets = result.candidates.map((c) => c.target)
    expect(targets).toEqual([transcriptPath(root, CWD, 'gone')])
    expect(targets).not.toContain(pointed)
    expect(result.countByKind.transcript).toBe(1)
    expect(result.liveCwds).toEqual([CWD])
    expect(result.touchedProjects).toEqual([NAME])
  })

  it('a transcript with a live writer is not a candidate', async () => {
    transcript('new', 1)
    const busy = transcript('busy', 100)
    transcript('idle', 120)
    const fs: ProjectsGCFs = { ...defaultFs(), hasLiveWriter: (p) => p === busy }
    const result = await plan({ fs })
    expect(result.candidates.map((c) => c.target)).toEqual([transcriptPath(root, CWD, 'idle')])
  })

  it('a lock whose transcript is gone and an atomic-write temp file are candidates, an editor swap file is not', async () => {
    transcript('new', 1)
    const kept = transcript('kept', 2)
    put(NAME, `${kept.split('/').pop()}.writer.lock`, 100)
    const lock = put(NAME, 'gone.jsonl.writer.lock', 100)
    const lockDir = put(NAME, 'gone.jsonl.lock', 100, true)
    const temp = put(NAME, 'state.json.1234.0123456789abcdef.tmp', 100)
    put(NAME, 'notes.txt.tmp', 100)
    put(NAME, '.foo.swp', 100)
    const result = await plan()
    expect(result.candidates.map((c) => c.target).sort((a, b) => a.localeCompare(b))).toEqual(
      [lock, lockDir, temp].sort((a, b) => a.localeCompare(b)),
    )
    expect(result.countByKind).toMatchObject({ 'writer-lock': 1, 'lock-directory': 1, temp: 1 })
  })

  it('a failed registry read skips the project and records an error', async () => {
    transcript('new', 1)
    transcript('old', 100)
    const result = await plan({ listRegistry: () => Promise.reject(new Error('registry down')) })
    expect(result.candidates).toEqual([])
    expect(result.errors).toEqual([
      { project: NAME, message: expect.stringContaining('registry down') },
    ])
  })

  it('an entry with no mtime is never collected', async () => {
    transcript('new', 1)
    const old = transcript('old', 100)
    const real = defaultFs()
    const result = await plan({
      fs: { ...real, stat: (p) => (p === old ? { isDirectory: false } : real.stat(p)) },
    })
    expect(result.candidates).toEqual([])
  })

  it.each([0, -1, Number.NaN])('maxAgeDays %s throws GCFloorError', async (maxAgeDays) => {
    await expect(plan({ maxAgeDays })).rejects.toBeInstanceOf(GCFloorError)
  })

  it('keepLast 0 throws GCFloorError', async () => {
    await expect(plan({ keepLast: 0 })).rejects.toBeInstanceOf(GCFloorError)
  })

  it('plans an old registry entry whose transcript is gone, keeps one with no age or a transcript', async () => {
    transcript('new', 1)
    transcript('has', 100)
    const result = await plan({
      keepLast: 1,
      listRegistry: () =>
        Promise.resolve([
          { id: 'orphan', lastModified: NOW - 30 * DAY, archived: true },
          { id: 'ageless' },
          { id: 'fresh', lastModified: NOW - DAY },
          { id: 'has', archived: true, lastModified: NOW - 100 * DAY },
        ]),
    })
    const registry = result.candidates.filter((c) => c.kind === 'registry')
    expect(registry.map((c) => c.target)).toEqual(['orphan'])
    // the archived 'has' transcript is old and unprotected, so it is a transcript candidate with its id
    expect(result.candidates.find((c) => c.kind === 'transcript')?.sessionId).toBe('has')
    expect(result.countByKind.registry).toBe(1)
  })

  it('a dead project plans transcripts and temps but no registry entries, and still reads registries', async () => {
    transcript('new', 1)
    transcript('old', 100)
    let asked = false
    const result = await plan({
      classify: () => new Map([[NAME, { liveness: 'dead', reason: 'gone', cwd: CWD }]]),
      listRegistry: () => {
        asked = true
        return Promise.resolve([{ id: 'orphan', lastModified: 0 }])
      },
    })
    expect(asked).toBe(true)
    expect(result.candidates.map((c) => c.kind)).toEqual(['transcript'])
    expect(result.liveCwds).toEqual([])
  })
})

describe('planProjectsGC protection edge cases', () => {
  it('a transcript that records no cwd keeps a live project whole', async () => {
    transcript('new', 1)
    const anon = transcriptPath(root, CWD, 'anon')
    writeFileSync(anon, JSON.stringify({ sessionId: 'anon' }) + '\n')
    const t = (NOW - 300 * DAY) / 1000
    utimesSync(anon, t, t)
    const result = await plan()
    expect(result.candidates).toEqual([])
    expect(result.touchedProjects).toEqual([])
  })

  function legacy(id: string, ageDays: number): string {
    const path = legacyTranscriptPath(root, CWD, id)
    writeFileSync(path, JSON.stringify({ sessionId: id, cwd: CWD }) + '\n')
    const t = (NOW - ageDays * DAY) / 1000
    utimesSync(path, t, t)
    return path
  }

  it('an old legacy transcript of an active registry entry is protected', async () => {
    transcript('new', 1)
    const old = legacy('active', 300)
    const result = await plan({ listRegistry: () => Promise.resolve([{ id: 'active' }]) })
    expect(result.candidates.map((c) => c.target)).not.toContain(old)
  })

  it('an old legacy transcript named by protectedIds is protected', async () => {
    transcript('new', 1)
    const old = legacy('named', 300)
    const result = await plan({ protectedIds: () => new Map([['named', 'app']]) })
    expect(result.candidates.map((c) => c.target)).not.toContain(old)
  })

  it('a transcript that cannot be stat-ed still counts as present for locks and registry', async () => {
    transcript('new', 1)
    const hidden = transcript('hidden', 100)
    const lock = put(NAME, `${hidden.split('/').pop()}.writer.lock`, 100)
    const real = defaultFs()
    const result = await plan({
      fs: {
        ...real,
        stat: (p) => {
          if (p === hidden) throw new Error('EACCES')
          return real.stat(p)
        },
      },
      listRegistry: () => Promise.resolve([{ id: 'hidden', lastModified: NOW - 100 * DAY }]),
    })
    expect(result.candidates.map((c) => c.target)).not.toContain(lock)
    expect(result.countByKind.registry).toBe(0)
  })

  it('a transcript registered by another cwd of the same encoded project is protected', async () => {
    const other = '/work-app'
    expect(encodeProjectDir(other)).toBe(NAME)
    transcript('new', 1)
    const theirs = transcriptPath(root, other, 'theirs')
    writeFileSync(theirs, JSON.stringify({ sessionId: 'theirs', cwd: other }) + '\n')
    const t = (NOW - 300 * DAY) / 1000
    utimesSync(theirs, t, t)
    const result = await plan({
      listRegistry: (cwd) => Promise.resolve(cwd === other ? [{ id: 'theirs' }] : []),
    })
    expect(result.candidates.map((c) => c.target)).not.toContain(theirs)
    expect(result.liveCwds).toContain(other)
  })

  it('a failed registry read for another cwd of the same encoded project skips the project', async () => {
    const other = '/work-app'
    transcript('new', 1)
    const theirs = transcriptPath(root, other, 'theirs')
    writeFileSync(theirs, JSON.stringify({ sessionId: 'theirs', cwd: other }) + '\n')
    const t = (NOW - 300 * DAY) / 1000
    utimesSync(theirs, t, t)
    const result = await plan({
      listRegistry: (cwd) =>
        cwd === other ? Promise.reject(new Error('boom')) : Promise.resolve([]),
    })
    expect(result.candidates).toEqual([])
    expect(result.errors).toHaveLength(1)
  })

  it('the default classifier sees a live colliding cwd beyond its first three transcripts', async () => {
    const other = '/work-app'
    const old = (NOW - 300 * DAY) / 1000
    for (const id of ['a', 'b', 'c', 'z-theirs']) {
      const owner = id === 'z-theirs' ? other : CWD
      const path = transcriptPath(root, owner, id)
      writeFileSync(path, JSON.stringify({ sessionId: id, cwd: owner }) + '\n')
      utimesSync(path, old, old)
    }
    transcript('new', 1)
    const real = defaultFs()
    const result = await planProjectsGC({
      projectsRoot: projects,
      keepLast: 1,
      maxAgeDays: 7,
      now: NOW,
      candidateCwds: () => [CWD],
      candidateCwdsComplete: true,
      fs: {
        ...real,
        stat: (p) => {
          if (p === other) return { isDirectory: true, mtimeMs: NOW }
          if (p === CWD) throw Object.assign(new Error('gone'), { code: 'ENOENT' })
          return real.stat(p)
        },
      },
      listRegistry: (cwd) => Promise.resolve(cwd === other ? [{ id: 'z-theirs' }] : []),
    })
    expect(result.liveCwds).toContain(other)
    expect(result.candidates.map((c) => c.target)).not.toContain(
      transcriptPath(root, other, 'z-theirs'),
    )
  })

  it('a registry cwd discovered only through a newest-kept transcript header still protects an old session', async () => {
    const other = '/work-app'
    const old = (NOW - 300 * DAY) / 1000
    const registered = transcript('registered', 300)
    const mine = transcriptPath(root, other, 'mine')
    writeFileSync(mine, JSON.stringify({ sessionId: 'mine', cwd: other }) + '\n')
    utimesSync(mine, (NOW - DAY) / 1000, (NOW - DAY) / 1000)
    utimesSync(registered, old, old)
    const asked: string[] = []
    const result = await plan({
      listRegistry: (cwd) => {
        asked.push(cwd)
        return Promise.resolve(cwd === other ? [{ id: 'registered' }] : [])
      },
    })
    expect(asked).toContain(other)
    expect(result.candidates.map((c) => c.target)).not.toContain(registered)
  })

  it('a live project is kept whole when a colliding cwd known only to its registry cannot be ruled out', async () => {
    const other = '/work-app'
    transcript('new', 1)
    const registered = transcript('registered', 300)
    const result = await plan({
      candidateCwds: undefined,
      listRegistry: (cwd) => Promise.resolve(cwd === other ? [{ id: 'registered' }] : []),
    })
    expect(result.candidates.map((c) => c.target)).not.toContain(registered)
    expect(result.candidates).toEqual([])
    expect(result.touchedProjects).toEqual([])
  })

  it('a live cwd discovered only through its registry keeps the project whole unless coverage is declared', async () => {
    const hidden = '/work-app' // encodes to the same directory, is alive, and appears in no list
    transcript('new', 1)
    const active = transcript('active', 300) // header names CWD; only hidden's registry lists it
    const listRegistry = (cwd: string) => Promise.resolve(cwd === hidden ? [{ id: 'active' }] : [])
    const undeclared = await plan({ candidateCwdsComplete: undefined, listRegistry })
    expect(undeclared.candidates.map((c) => c.target)).not.toContain(active)
    expect(undeclared.candidates).toEqual([])
    expect(undeclared.kept.some((k) => k.reason.includes('candidateCwdsComplete'))).toBe(true)
  })

  it('a dead verdict does not hide a live cwd known only to its registry', async () => {
    const hidden = '/work-app'
    transcript('new', 1)
    const active = transcript('active', 300)
    const dead = () => new Map([[NAME, { liveness: 'dead' as const, reason: 'gone', cwd: CWD }]])
    const listRegistry = (cwd: string) => Promise.resolve(cwd === hidden ? [{ id: 'active' }] : [])
    const undeclared = await plan({
      classify: dead,
      candidateCwdsComplete: undefined,
      listRegistry,
    })
    expect(undeclared.candidates).toEqual([])
    const declared = await plan({ classify: dead, candidateCwds: () => [hidden], listRegistry })
    expect(declared.candidates.map((c) => c.target)).not.toContain(active)
  })

  it('the default classifier calls a project dead when its header cwd is gone, yet the registry cwd still protects', async () => {
    const hidden = '/work-app'
    transcript('new', 1)
    const active = transcript('active', 300)
    const stale = transcript('stale', 300)
    const base = defaultFs()
    // Only the header cwd is gone: every other path resolves normally.
    const fs: ProjectsGCFs = {
      ...base,
      stat: (p) => {
        if (p === CWD) throw Object.assign(new Error('gone'), { code: 'ENOENT' })
        return base.stat(p)
      },
    }
    const asked: string[] = []
    const result = await plan({
      classify: undefined,
      fs,
      candidateCwds: () => [hidden],
      listRegistry: (cwd) => {
        asked.push(cwd)
        return Promise.resolve(cwd === hidden ? [{ id: 'active' }] : [])
      },
    })
    expect(result.kept.some((k) => k.reason.includes('undetermined'))).toBe(false)
    expect(asked).toContain(hidden)
    expect(result.candidates.map((c) => c.target)).toContain(stale)
    expect(result.candidates.map((c) => c.target)).not.toContain(active)
  })

  it('a dead project with a malformed transcript header is kept whole', async () => {
    transcript('new', 1)
    transcript('old', 100)
    const bad = transcriptPath(root, CWD, 'bad')
    writeFileSync(bad, 'not json\n')
    const t = (NOW - 300 * DAY) / 1000
    utimesSync(bad, t, t)
    const result = await plan({
      classify: () => new Map([[NAME, { liveness: 'dead', reason: 'gone', cwd: CWD }]]),
    })
    expect(result.candidates).toEqual([])
    expect(result.touchedProjects).toEqual([])
  })

  it('a transcript that cannot be stat-ed keeps a live project whole', async () => {
    transcript('new', 1)
    const hidden = transcript('hidden', 100)
    const real = defaultFs()
    const result = await plan({
      fs: {
        ...real,
        stat: (p) => {
          if (p === hidden) throw new Error('EACCES')
          return real.stat(p)
        },
      },
    })
    expect(result.candidates).toEqual([])
  })

  it('a colliding cwd with no transcript of its own is protected through candidateCwds', async () => {
    const other = '/work-app'
    transcript('new', 1)
    const registered = transcript('registered', 300)
    const asked: string[] = []
    const result = await plan({
      candidateCwds: () => [other, '/elsewhere'],
      candidateCwdsComplete: true,
      listRegistry: (cwd) => {
        asked.push(cwd)
        return Promise.resolve(cwd === other ? [{ id: 'registered' }] : [])
      },
    })
    expect(asked).toContain(other)
    expect(asked).not.toContain('/elsewhere')
    expect(result.candidates.map((c) => c.target)).not.toContain(registered)
  })
})

function defaultFs(): ProjectsGCFs {
  return {
    readdir: (d) => readdirSync(d),
    stat: (p) => {
      const s = statSync(p)
      return { isDirectory: s.isDirectory(), mtimeMs: s.mtimeMs }
    },
    readFile: (p) => readFileSync(p, 'utf8'),
    hasLiveWriter: () => false,
  }
}
