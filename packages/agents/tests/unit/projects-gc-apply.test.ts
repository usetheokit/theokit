import { existsSync, readFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { encodeProjectDir } from '@theokit/sdk/persistence'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  claimCollectorRoot,
  CollectorRootNotOwnedError,
  runProjectsGC,
  type ProjectsGCCandidate,
  type ProjectsGCPlan,
} from '../../src/session/index.js'
import { sessionPointerPath } from '../../src/session/session-pointer.js'

let home: string
let projects: string
const CWD = '/work/app'
const NAME = encodeProjectDir(CWD)
const OWNER = { app: 'theocode' }
const noWriter = { hasLiveWriter: () => false }

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'projects-gc-apply-'))
  projects = join(home, 'projects')
  mkdirSync(join(projects, NAME), { recursive: true })
  claimCollectorRoot(projects, OWNER)
})
afterEach(() => rmSync(home, { recursive: true, force: true }))

function file(name: string): string {
  const path = join(projects, NAME, name)
  writeFileSync(path, '{}\n')
  return path
}

function planOf(
  candidates: Omit<ProjectsGCCandidate, 'project' | 'ageDays'>[],
  liveCwds: string[] = [CWD],
): ProjectsGCPlan {
  return {
    projectsRoot: projects,
    candidates: candidates.map((c) => ({ project: NAME, ageDays: 100, ...c })),
    kept: [],
    touchedProjects: [NAME],
    liveCwds,
    countByKind: { transcript: 0, 'writer-lock': 0, 'lock-directory': 0, temp: 0, registry: 0 },
    errors: [],
  }
}

describe('runProjectsGC', () => {
  it('a dry run removes nothing and lists every candidate', async () => {
    const a = file('a.jsonl')
    const b = file('b.jsonl.tmp-1')
    const result = await runProjectsGC(
      planOf([
        { kind: 'transcript', target: a },
        { kind: 'temp', target: b },
      ]),
      { apply: false },
    )
    expect(result.dryRun).toBe(true)
    expect(result.removed).toEqual([a, b])
    expect(existsSync(a) && existsSync(b)).toBe(true)
  })

  it('a transcript that gained a live writer after the plan is refused, not removed', async () => {
    const a = file('a.jsonl')
    const result = await runProjectsGC(planOf([{ kind: 'transcript', target: a }]), {
      apply: true,
      owner: OWNER,
      fs: { readFile: () => '', hasLiveWriter: () => true },
    })
    expect(result.refused).toHaveLength(1)
    expect(result.removed).toEqual([])
    expect(existsSync(a)).toBe(true)
  })

  it('a session the pointer names after the plan is refused', async () => {
    const a = file('a.jsonl')
    writeFileSync(join(projects, NAME, 'last-session'), 'a')
    const result = await runProjectsGC(planOf([{ kind: 'transcript', target: a }]), {
      apply: true,
      owner: OWNER,
      fs: { ...noWriter, readFile: (p) => readFileSync(p, 'utf8') },
      protectedIds: () => new Map([['a', 'protected now']]),
    })
    expect(result.refused[0]?.reason).toContain('protected now')
    expect(existsSync(a)).toBe(true)
  })

  it('a registered transcript is removed through removeFromRegistry', async () => {
    const a = file('a.jsonl')
    const remove = vi.fn()
    const result = await runProjectsGC(
      planOf([{ kind: 'transcript', target: a, sessionId: 'a' }]),
      {
        apply: true,
        owner: OWNER,
        removeFromRegistry: remove,
        fs: {
          ...noWriter,
          readFile: () => {
            throw Object.assign(new Error('x'), { code: 'ENOENT' })
          },
        },
      },
    )
    expect(remove).toHaveBeenCalledWith('a')
    expect(existsSync(a)).toBe(false)
    expect(result.removed).toContain(a)
  })

  it('an already-missing target is not an error', async () => {
    const result = await runProjectsGC(
      planOf([{ kind: 'transcript', target: join(projects, NAME, 'gone.jsonl') }]),
      {
        apply: true,
        owner: OWNER,
        fs: {
          ...noWriter,
          readFile: () => {
            throw Object.assign(new Error('x'), { code: 'ENOENT' })
          },
        },
      },
    )
    expect(result.errors).toEqual([])
  })

  it('an emptied project directory is removed', async () => {
    const a = file('a.jsonl')
    const result = await runProjectsGC(planOf([{ kind: 'transcript', target: a }]), {
      apply: true,
      owner: OWNER,
      fs: {
        ...noWriter,
        readFile: () => {
          throw Object.assign(new Error('x'), { code: 'ENOENT' })
        },
      },
    })
    expect(existsSync(join(projects, NAME))).toBe(false)
    expect(result.removed).toContain(join(projects, NAME))
  })

  it('apply on a root owned by another app throws CollectorRootNotOwnedError', async () => {
    const a = file('a.jsonl')
    const error = await runProjectsGC(planOf([{ kind: 'transcript', target: a }]), {
      apply: true,
      owner: { app: 'intruder' },
    }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(CollectorRootNotOwnedError)
    const typed = error as CollectorRootNotOwnedError
    expect(typed.code).toBe('collector_root_not_owned')
    expect(typed.message).toContain('intruder')
    expect(typed.message).toContain('theocode')
    expect(existsSync(a)).toBe(true)
  })

  it('applies under a legacy marker, and refuses a transcript the pointer now names', async () => {
    rmSync(join(home, '.theokit-collector.json'))
    writeFileSync(join(home, '.legacy.json'), JSON.stringify({ product: 'theocode' }))
    const existingMarker = {
      fileName: '.legacy.json',
      ownerOf: (p: unknown) => (p as { product?: string }).product,
    }
    const a = file('a.jsonl')
    const b = file('b.jsonl')
    writeFileSync(sessionPointerPath(CWD, home), 'b\n')
    const result = await runProjectsGC(
      planOf([
        { kind: 'transcript', target: a },
        { kind: 'transcript', target: b, sessionId: undefined },
      ]),
      {
        apply: true,
        owner: OWNER,
        existingMarker,
        ...noWriter,
      },
    )
    expect(existsSync(a)).toBe(false)
    expect(existsSync(b)).toBe(true)
    expect(result.refused).toHaveLength(1)
  })
})
