/**
 * An in-memory projects tree for planning tests: the framework's `planProjectsGC` over its `fs` and
 * `classify` seams, wired the way `planAllProjectsOnDisk` wires it (TheoCode's pointer through
 * `protectedIds`, `candidateCwds` declared complete). Nothing here touches the disk.
 */
import { basename, dirname, join } from 'node:path'

import { encodeProjectDir, transcriptPath } from '@theokit/agents/persistence'
import {
  planProjectsGC,
  type LivenessVerdict,
  type ProjectsGCFs,
  type ProjectsGCPlan,
  type ProjectsGCRegistryEntry,
} from '@theokit/agents/session'

import { readPointerId } from '../../../src/session/gc/pointer.js'

const DAY = 86_400_000
const NOW = 1_000 * DAY
const PROJECTS_ROOT = '/virtual-theocode-home/projects'

export interface VEntry {
  readonly name: string
  readonly isDirectory?: boolean
  /** Left undefined, the entry cannot be dated (the stat reports no mtime). */
  readonly ageDays?: number
}

export interface VOptions {
  /** cwd -> the entries of its project directory. */
  readonly projects: Readonly<Record<string, readonly VEntry[]>>
  readonly keepLast?: number
  readonly maxAgeDays?: number
  readonly liveness?: (cwd: string) => 'alive' | 'dead' | 'undetermined'
  readonly registry?: (cwd: string) => Promise<readonly ProjectsGCRegistryEntry[]>
  /** The live-session pointer's id for a cwd; may throw. */
  readonly pointer?: (cwd: string) => string | undefined
  readonly hasLiveWriter?: (transcript: string) => boolean
  /** Make the project listing itself fail. */
  readonly readdirRoot?: () => never
}

export const projectOf = (cwd: string): string => encodeProjectDir(cwd)
export const targetOf = (cwd: string, name: string): string =>
  join(PROJECTS_ROOT, projectOf(cwd), name)

function classifyVirtual(
  projects: readonly string[],
  byProject: ReadonlyMap<string, { cwd: string }>,
  liveness: VOptions['liveness'],
): Map<string, LivenessVerdict> {
  return new Map(
    projects.map((p): [string, LivenessVerdict] => {
      const cwd = byProject.get(p)?.cwd as string
      const state = liveness?.(cwd) ?? 'dead'
      return [
        p,
        state === 'undetermined'
          ? { liveness: 'undetermined', reason: 'EACCES' }
          : { liveness: state, cwd, reason: 'test' },
      ] as [string, LivenessVerdict]
    }),
  )
}

export async function planVirtual(o: VOptions): Promise<ProjectsGCPlan> {
  const byProject = new Map(
    Object.entries(o.projects).map(([cwd, e]) => [projectOf(cwd), { cwd, e }]),
  )
  const entryAt = (path: string): { cwd: string; entry: VEntry } | undefined => {
    const project = byProject.get(path.split('/').at(-2) ?? '')
    const entry = project?.e.find((x) => x.name === path.split('/').at(-1))
    return project === undefined || entry === undefined ? undefined : { cwd: project.cwd, entry }
  }
  const fs: ProjectsGCFs = {
    readdir: (dir) => {
      if (dir === PROJECTS_ROOT) {
        if (o.readdirRoot !== undefined) o.readdirRoot()
        return [...byProject.keys()]
      }
      const p = byProject.get(dir.split('/').at(-1) ?? '')
      if (p === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      return p.e.map((x) => x.name)
    },
    stat: (path) => {
      if (byProject.has(path.split('/').at(-1) ?? '') && dirname(path) === PROJECTS_ROOT) {
        return { isDirectory: true }
      }
      const hit = entryAt(path)
      if (hit === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      return {
        isDirectory: hit.entry.isDirectory ?? false,
        ...(hit.entry.ageDays === undefined ? {} : { mtimeMs: NOW - hit.entry.ageDays * DAY }),
      }
    },
    // A transcript's first line records the cwd of its project; anything else (a pointer) is absent.
    readFile: (path) => {
      const hit = entryAt(path)
      if (hit === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      return `${JSON.stringify({ cwd: hit.cwd })}\n`
    },
    hasLiveWriter: o.hasLiveWriter ?? (() => false),
  }
  return planProjectsGC({
    projectsRoot: PROJECTS_ROOT,
    keepLast: o.keepLast ?? 1,
    maxAgeDays: o.maxAgeDays ?? 30,
    now: NOW,
    fs,
    classify: (projects) => classifyVirtual(projects, byProject, o.liveness),
    listRegistry: o.registry ?? (async () => []),
    protectedIds: (cwd) => {
      if (o.pointer === undefined) return new Map()
      return pointerMap(cwd, o.pointer)
    },
    candidateCwds: () => [],
    candidateCwdsComplete: true,
  })
}

/** TheoCode's own pointer read, with the read stubbed: its error wording is what is asserted on. */
function pointerMap(
  cwd: string,
  pointer: (cwd: string) => string | undefined,
): Map<string, string> {
  const id = readPointerId(cwd, () => {
    const value = pointer(cwd)
    if (value === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    return value
  })
  return id === undefined ? new Map() : new Map([[id, 'TUI live-session pointer']])
}

export const targets = (plan: ProjectsGCPlan): string[] => plan.candidates.map((c) => c.target)

/** What the transcript of session `id` is called on disk for `cwd` — the SDK's own mapping. */
export const fileOf = (cwd: string, id: string): string =>
  basename(transcriptPath(dirname(PROJECTS_ROOT), cwd, id))
