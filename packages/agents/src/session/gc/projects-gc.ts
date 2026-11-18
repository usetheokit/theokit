import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

import { Agent } from '@theokit/sdk'
import {
  classifySessionArtifact,
  encodeProjectDir,
  legacyTranscriptPath,
  sessionHasWriter,
  transcriptPath,
} from '@theokit/sdk/persistence'

import { classifyProjects, type FsSeam, type LivenessVerdict } from '../liveness-oracle.js'
import { protectedTranscriptPaths } from '../session-lifecycle.js'
import { sessionPointerPath } from '../session-pointer.js'

import { GCFloorError } from './transcript-gc.js'

/**
 * Part 1 of 3 of the all-projects collector: the READ-ONLY plan.
 *
 * `planTranscriptGC` answers for one `cwd`. An app that wants to reclaim disk across every project it
 * ever ran in used to walk `projects/` itself and re-derive the safety rules. This module walks once
 * and decides per project; it NEVER deletes (applying a plan is a later part).
 *
 * The safety rules, each with a test:
 *
 * 1. An `undetermined` project is kept whole. Not-knowing is not absence.
 * 2. An entry whose mtime cannot be read is never collected.
 * 3. Protected transcripts survive: the newest `keepLast`, the newest, the pointer's, every
 *    non-archived registry entry's, and anything with a live writer. A pointer or registry read that
 *    fails skips the project with an error rather than assuming "nothing is live".
 * 4. Artifacts are recognised by the SDK's `classifySessionArtifact`, never by a suffix match here,
 *    so an editor's `notes.txt.tmp` or `.foo.swp` is not ours to delete.
 */

export type ProjectsGCKind = 'transcript' | 'writer-lock' | 'lock-directory' | 'temp' | 'registry'

export interface ProjectsGCCandidate {
  /** Encoded project dir name. */
  readonly project: string
  readonly kind: ProjectsGCKind
  /** Absolute path, or the session id for kind `registry`. */
  readonly target: string
  /** For a registered transcript, what `Agent.delete` takes. */
  readonly sessionId?: string
  readonly ageDays: number
}

export interface ProjectsGCPlan {
  readonly projectsRoot: string
  readonly candidates: readonly ProjectsGCCandidate[]
  readonly kept: readonly { project: string; reason: string }[]
  readonly touchedProjects: readonly string[]
  readonly liveCwds: readonly string[]
  readonly countByKind: Readonly<Record<ProjectsGCKind, number>>
  readonly errors: readonly { project: string; message: string }[]
}

/** One registry entry. `lastModified` (ms since epoch) is what lets an orphan entry be shown old. */
export interface ProjectsGCRegistryEntry {
  readonly id: string
  readonly archived?: boolean
  readonly lastModified?: number
}

/** Test seams for the filesystem reads. Every method may throw; a throw is never read as "absent". */
export interface ProjectsGCFs {
  readdir: (dir: string) => readonly string[]
  /** `mtimeMs` is `undefined` when the time cannot be read. Throws when the entry cannot be stat-ed. */
  stat: (path: string) => { readonly isDirectory: boolean; readonly mtimeMs?: number }
  readFile: (path: string) => string
  hasLiveWriter: (transcript: string) => boolean
}

export interface PlanProjectsGCOptions {
  readonly projectsRoot: string
  /** Floor 1: `GCFloorError` below. */
  readonly keepLast: number
  /** Floor 1: `GCFloorError` below. */
  readonly maxAgeDays: number
  readonly now?: number
  /** Read the registry for a live cwd; default lists through `Agent.list`. */
  readonly listRegistry?: (cwd: string) => Promise<readonly ProjectsGCRegistryEntry[]>
  /** Extra protection (id -> reason), unioned with the built-in one. A throw skips that project. */
  readonly protectedIds?: (cwd: string) => ReadonlyMap<string, string>
  /** Liveness per encoded project dir. Default: `classifyProjects` over the real filesystem. */
  readonly classify?: (
    projects: readonly string[],
    fs: ProjectsGCFs,
  ) => ReadonlyMap<string, LivenessVerdict>
  readonly fs?: ProjectsGCFs
}

const DAY_MS = 86_400_000

const defaultFs: ProjectsGCFs = {
  readdir: (dir) => readdirSync(dir),
  stat: (path) => {
    const s = statSync(path)
    return { isDirectory: s.isDirectory(), mtimeMs: s.mtimeMs }
  },
  readFile: (path) => readFileSync(path, 'utf8'),
  hasLiveWriter: (transcript) => sessionHasWriter(transcript),
}

async function defaultListRegistry(cwd: string): Promise<readonly ProjectsGCRegistryEntry[]> {
  const result = await Agent.list({ runtime: 'local', cwd })
  return result.items.map((item) => ({
    id: item.agentId,
    archived: item.archived,
    lastModified: item.lastModified,
  }))
}

function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The oracle's seam, built from ours. ENOENT is the only errno that means absence. */
function livenessFs(fs: ProjectsGCFs): FsSeam {
  return {
    exists: (path) => {
      try {
        fs.stat(path)
        return true
      } catch (error) {
        return isNotFound(error) ? false : undefined
      }
    },
    listEntries: (dir) => fs.readdir(dir),
    firstLine: (file) => fs.readFile(file).split('\n', 1)[0] ?? '',
  }
}

function defaultClassify(
  root: string,
  projects: readonly string[],
  fs: ProjectsGCFs,
): ReadonlyMap<string, LivenessVerdict> {
  return classifyProjects(projects, {
    projectsRoot: root,
    // The cwd is read from the transcripts themselves; no guessed pool, so a project whose
    // transcripts name no cwd stays `undetermined` instead of being searched for.
    candidatePaths: () => [],
    budget: 8 * projects.length + 8,
    fs: livenessFs(fs),
  })
}

interface Entry {
  readonly name: string
  readonly path: string
  readonly mtimeMs: number | undefined
  readonly kind: 'transcript' | 'writer-lock' | 'lock-directory' | 'temp'
}

function ageDaysOf(now: number, mtimeMs: number): number {
  return (now - mtimeMs) / DAY_MS
}

/** Whether a timestamp is a usable, past-or-present instant. */
function usable(ms: number | undefined): ms is number {
  return typeof ms === 'number' && Number.isFinite(ms)
}

/** The transcript file name a lock artifact guards, or `undefined`. */
function lockedTranscriptName(entry: Entry): string | undefined {
  if (entry.kind === 'writer-lock') return entry.name.slice(0, -'.writer.lock'.length)
  if (entry.kind === 'lock-directory') return entry.name.slice(0, -'.lock'.length)
  return undefined
}

/**
 * Decide what a retention policy would collect across every project, without touching anything.
 *
 * @throws {GCFloorError} when `keepLast` or `maxAgeDays` is below 1 (refused, never clamped).
 */
export async function planProjectsGC(options: PlanProjectsGCOptions): Promise<ProjectsGCPlan> {
  if (!Number.isFinite(options.keepLast) || options.keepLast < 1) {
    throw new GCFloorError('keepLast', options.keepLast)
  }
  if (!Number.isFinite(options.maxAgeDays) || options.maxAgeDays < 1) {
    throw new GCFloorError('maxAgeDays', options.maxAgeDays)
  }

  const fs = options.fs ?? defaultFs
  const now = options.now ?? Date.now()
  const cutoff = now - options.maxAgeDays * DAY_MS
  const root = dirname(options.projectsRoot) // the transcript root the SDK helpers take
  const listRegistry = options.listRegistry ?? defaultListRegistry

  const candidates: ProjectsGCCandidate[] = []
  const kept: { project: string; reason: string }[] = []
  const errors: { project: string; message: string }[] = []
  const liveCwds = new Set<string>()
  const touched = new Set<string>()

  let projects: string[] = []
  try {
    projects = fs
      .readdir(options.projectsRoot)
      .filter((name) => {
        try {
          return fs.stat(join(options.projectsRoot, name)).isDirectory
        } catch {
          return false
        }
      })
      .sort((a, b) => a.localeCompare(b))
  } catch (error) {
    if (!isNotFound(error)) errors.push({ project: '', message: messageOf(error) })
  }

  let verdicts: ReadonlyMap<string, LivenessVerdict>
  try {
    verdicts =
      options.classify?.(projects, fs) ?? defaultClassify(options.projectsRoot, projects, fs)
  } catch (error) {
    errors.push({ project: '', message: `liveness classification failed: ${messageOf(error)}` })
    verdicts = new Map()
  }

  for (const project of projects) {
    const verdict = verdicts.get(project)
    if (verdict === undefined || verdict.liveness === 'undetermined') {
      kept.push({
        project,
        reason: `liveness undetermined, project kept whole${verdict === undefined ? '' : ': ' + verdict.reason}`,
      })
      continue
    }
    const live = verdict.liveness === 'alive'
    const cwd = verdict.cwd
    if (live && cwd === undefined) {
      kept.push({ project, reason: 'live project with no resolved cwd, kept whole' })
      continue
    }

    const dir = join(options.projectsRoot, project)
    const fail = (message: string): void => {
      errors.push({ project, message })
      kept.push({ project, reason: `skipped: ${message}` })
    }

    // 1. List and classify the entries.
    const entries: Entry[] = []
    const unreadableTranscripts = new Set<string>()
    try {
      for (const name of fs.readdir(dir)) {
        const path = join(dir, name)
        let stat: ReturnType<ProjectsGCFs['stat']>
        try {
          stat = fs.stat(path)
        } catch {
          // Unreadable: it cannot be shown old, so it is not collected. It also cannot be listed as
          // a transcript, which is why a lock beside it is judged against the names that DID read.
          kept.push({ project, reason: `${name}: cannot be read, never collected` })
          // It exists, even if it cannot be stat-ed: orphan decisions must still see it.
          if (classifySessionArtifact(name, false) === 'transcript') unreadableTranscripts.add(name)
          continue
        }
        const kind = classifySessionArtifact(name, stat.isDirectory)
        if (kind === undefined) continue
        entries.push({ name, path, mtimeMs: usable(stat.mtimeMs) ? stat.mtimeMs : undefined, kind })
      }
    } catch (error) {
      fail(`cannot list project: ${messageOf(error)}`)
      continue
    }

    // 2. Protection. The encoding is many-to-one, so the verdict's cwd is only ONE member of the
    //    project's collision class: every cwd the transcripts record is consulted too, and a pointer
    //    or registry read that fails for any of them skips the project.
    const protectedBy = new Map<string, string>()
    const registry: { readonly cwd: string; readonly entry: ProjectsGCRegistryEntry }[] = []
    const protect = (id: string, cwdOf: string, reason: string): void => {
      protectedBy.set(transcriptPath(root, cwdOf, id), reason)
      protectedBy.set(legacyTranscriptPath(root, cwdOf, id), reason)
    }
    if (live && cwd !== undefined) {
      const cwds = new Set([cwd])
      for (const entry of entries) {
        if (entry.kind !== 'transcript') continue
        try {
          const recorded = (
            JSON.parse(fs.readFile(entry.path).split('\n', 1)[0] ?? '') as {
              cwd?: unknown
            } | null
          )?.cwd
          if (typeof recorded === 'string' && encodeProjectDir(recorded) === project) {
            cwds.add(recorded)
          }
        } catch {
          // A transcript that names no cwd adds no member to the class.
        }
      }
      try {
        for (const member of cwds) {
          try {
            const id = fs.readFile(sessionPointerPath(member, root)).trim()
            if (id.length > 0) protect(id, member, 'resumable session pointer')
          } catch (error) {
            if (!isNotFound(error)) throw new Error(`pointer read failed: ${messageOf(error)}`)
          }
          let listed: readonly ProjectsGCRegistryEntry[]
          try {
            listed = await listRegistry(member)
          } catch (error) {
            throw new Error(`registry read failed: ${messageOf(error)}`)
          }
          for (const entry of listed) {
            registry.push({ cwd: member, entry })
            if (entry.archived !== true) protect(entry.id, member, 'active registry entry')
          }
          try {
            for (const [id, reason] of options.protectedIds?.(member) ?? []) {
              protect(id, member, reason)
            }
            for (const [path, reason] of protectedTranscriptPaths(member, root)) {
              if (!protectedBy.has(path)) protectedBy.set(path, reason)
            }
          } catch (error) {
            throw new Error(`protection unavailable: ${messageOf(error)}`)
          }
        }
      } catch (error) {
        fail(messageOf(error))
        continue
      }
      for (const member of cwds) liveCwds.add(member)
    }

    const idByName = new Map<string, string>()
    for (const { cwd: member, entry } of registry) {
      idByName.set(basename(transcriptPath(root, member, entry.id)), entry.id)
      idByName.set(basename(legacyTranscriptPath(root, member, entry.id)), entry.id)
    }

    const ownedNames = new Set([
      ...entries.filter((e) => e.kind === 'transcript').map((e) => e.name),
      ...unreadableTranscripts,
    ])
    const add = (c: Omit<ProjectsGCCandidate, 'project'>): void => {
      candidates.push({ project, ...c })
      touched.add(project)
    }

    // 3. Transcripts, newest first. An entry with no mtime is never collected, and does not count
    //    against `keepLast`.
    const transcripts = entries
      .filter((e) => e.kind === 'transcript')
      .sort((a, b) => (b.mtimeMs ?? -Infinity) - (a.mtimeMs ?? -Infinity))
    let rank = 0
    for (const entry of transcripts) {
      if (entry.mtimeMs === undefined) {
        kept.push({ project, reason: `${entry.name}: modification time unreadable` })
        continue
      }
      rank += 1
      const reason =
        protectedBy.get(entry.path) ??
        (rank <= options.keepLast ? `within the newest ${String(options.keepLast)}` : undefined)
      if (reason !== undefined) {
        kept.push({ project, reason: `${entry.name}: ${reason}` })
        continue
      }
      if (entry.mtimeMs >= cutoff) {
        kept.push({
          project,
          reason: `${entry.name}: younger than ${String(options.maxAgeDays)} days`,
        })
        continue
      }
      let writer: boolean
      try {
        writer = fs.hasLiveWriter(entry.path)
      } catch {
        writer = true // cannot tell, so assume there is one
      }
      if (writer) {
        kept.push({ project, reason: `${entry.name}: active writer lease` })
        continue
      }
      add({
        kind: 'transcript',
        target: entry.path,
        sessionId: idByName.get(entry.name),
        ageDays: ageDaysOf(now, entry.mtimeMs),
      })
    }

    // 4. Locks whose transcript is gone, and temp files. Both only past the window, so a lock a
    //    process is taking right now, or a write in flight, is left alone.
    for (const entry of entries) {
      if (entry.kind === 'transcript') continue
      if (entry.mtimeMs === undefined || entry.mtimeMs >= cutoff) continue
      const guarded = lockedTranscriptName(entry)
      if (guarded !== undefined && ownedNames.has(guarded)) continue
      add({ kind: entry.kind, target: entry.path, ageDays: ageDaysOf(now, entry.mtimeMs) })
    }

    // 5. Registry entries (live projects only) older than the window whose transcript is gone. An
    //    entry with no usable age cannot be shown old, so it stays.
    for (const { cwd: member, entry } of registry) {
      if (!usable(entry.lastModified) || entry.lastModified >= cutoff) continue
      const names = [
        transcriptPath(root, member, entry.id),
        legacyTranscriptPath(root, member, entry.id),
      ]
      if (names.some((p) => ownedNames.has(basename(p)))) continue
      add({
        kind: 'registry',
        target: entry.id,
        sessionId: entry.id,
        ageDays: ageDaysOf(now, entry.lastModified),
      })
    }
  }

  const countByKind: Record<ProjectsGCKind, number> = {
    transcript: 0,
    'writer-lock': 0,
    'lock-directory': 0,
    temp: 0,
    registry: 0,
  }
  for (const c of candidates) countByKind[c.kind] += 1

  return {
    projectsRoot: options.projectsRoot,
    candidates,
    kept,
    touchedProjects: [...touched],
    liveCwds: [...liveCwds],
    countByKind,
    errors,
  }
}
