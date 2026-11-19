import { readdirSync, readFileSync, rmdirSync, statSync, unlinkSync } from 'node:fs'
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

import { collectorRootOwner, CollectorRootNotOwnedError } from './collector-root.js'
import { awaitRegistryRemoval } from './registry-remover.js'
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
  /**
   * Extra real cwds that may share a project directory with others, e.g. every workspace the app
   * knows. Those that encode to a project are consulted like the cwds its transcripts record, so a
   * colliding cwd with no transcript of its own is still protected. The encoding is lossy and cannot
   * be enumerated from the name alone. Required to plan a live project: without it a live project is
   * kept whole, because a colliding cwd known only to its own registry cannot be discovered.
   * The caller vouches that the list names EVERY cwd of the app that could share a project directory; the
   * registries are per cwd and cannot be enumerated from disk, so completeness is the caller's declaration.
   */
  readonly candidateCwds?: () => readonly string[]
  /**
   * The caller's explicit declaration that `candidateCwds` names EVERY cwd that could share a project
   * directory. Registries cannot be enumerated from disk, so a list alone proves nothing: without
   * `true` here a live project is kept whole, whatever `candidateCwds` returns.
   */
  readonly candidateCwdsComplete?: boolean
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

function countEntries(root: string, projects: readonly string[], fs: ProjectsGCFs): number {
  let total = 0
  for (const project of projects) {
    try {
      total += fs.readdir(join(root, project)).length
    } catch {
      // an unreadable project is classified undetermined by the oracle
    }
  }
  return total
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
    // Every transcript is sampled, so a live colliding cwd past the first few is never missed; the
    // budget covers one listing, one header read and one existence probe per transcript.
    transcriptSamples: Number.MAX_SAFE_INTEGER,
    budget: 8 * projects.length + 8 + 4 * countEntries(root, projects, fs),
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
    // Ownership: every transcript's header must name a cwd of this project. One that cannot be read,
    // parsed or attributed may belong to a cwd nobody has seen, whatever the verdict says (a dead
    // verdict can rest on the headers that DID read), so the project is kept whole.
    const headerCwds = new Set<string>()
    let unattributed = [...unreadableTranscripts][0] as string | undefined
    for (const entry of entries) {
      if (entry.kind !== 'transcript') continue
      try {
        const recorded = (
          JSON.parse(fs.readFile(entry.path).split('\n', 1)[0] ?? '') as { cwd?: unknown } | null
        )?.cwd
        if (typeof recorded === 'string' && encodeProjectDir(recorded) === project) {
          headerCwds.add(recorded)
        } else {
          unattributed ??= entry.name
        }
      } catch {
        unattributed ??= entry.name
      }
    }
    if (unattributed !== undefined) {
      kept.push({
        project,
        reason: `${unattributed}: records no cwd of this project, so its owner cannot be established; project kept whole`,
      })
      continue
    }
    {
      // The encoding is many-to-one and registries cannot be enumerated: a colliding live cwd may
      // appear in no header and no verdict, only in its own registry. Registry coverage is complete
      // only when the caller declares the cwds it knows; otherwise the project is kept whole.
      if (options.candidateCwds === undefined || options.candidateCwdsComplete !== true) {
        kept.push({
          project,
          reason:
            'registry coverage of every cwd sharing this directory cannot be established without candidateCwds and candidateCwdsComplete: true; project kept whole',
        })
        continue
      }
      // A dead verdict can rest on the headers that read: a colliding cwd that is alive but appears
      // only in its own registry makes it wrong, so the same guard and registry reads apply.
      const cwds = new Set([...(cwd === undefined ? [] : [cwd]), ...headerCwds])
      for (const extra of options.candidateCwds()) {
        if (encodeProjectDir(extra) === project) cwds.add(extra)
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
            for (const [path, reason] of await protectedTranscriptPaths(member, root)) {
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
      if (live) for (const member of cwds) liveCwds.add(member)
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
    for (const { cwd: member, entry } of live ? registry : []) {
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

export interface RunProjectsGCOptions {
  readonly apply: boolean
  /** The app applying the plan. Required to apply: it must own `plan.projectsRoot` (see `claimCollectorRoot`). */
  readonly owner?: { readonly app: string }
  /** Removes a registered session; default `Agent.delete`. */
  readonly removeFromRegistry?: (sessionId: string) => unknown
  readonly registryTimeoutMs?: number
  /** Extra protection re-read just before each removal. A throw refuses the candidate. */
  readonly protectedIds?: (cwd: string) => ReadonlyMap<string, string>
  readonly fs?: Pick<ProjectsGCFs, 'readFile' | 'hasLiveWriter'>
}

export interface RunProjectsGCResult {
  readonly dryRun: boolean
  readonly removed: readonly string[]
  readonly refused: readonly { target: string; reason: string }[]
  readonly errors: readonly { target: string; message: string }[]
}

/** Sessions that must survive right now, as absolute transcript paths -> reason. Throws when unknowable. */
function protectionNow(
  plan: ProjectsGCPlan,
  options: RunProjectsGCOptions,
  fs: Pick<ProjectsGCFs, 'readFile'>,
): { paths: Map<string, string>; ids: Map<string, string> } {
  const root = dirname(plan.projectsRoot)
  const paths = new Map<string, string>()
  const ids = new Map<string, string>()
  const protect = (id: string, cwd: string, reason: string): void => {
    ids.set(id, reason)
    paths.set(transcriptPath(root, cwd, id), reason)
    paths.set(legacyTranscriptPath(root, cwd, id), reason)
  }
  for (const cwd of plan.liveCwds) {
    try {
      const id = fs.readFile(sessionPointerPath(cwd, root)).trim()
      if (id.length > 0) protect(id, cwd, 'the session pointer now names it')
    } catch (error) {
      if (!isNotFound(error)) throw new Error(`pointer read failed: ${messageOf(error)}`)
    }
    for (const [id, reason] of options.protectedIds?.(cwd) ?? []) protect(id, cwd, reason)
  }
  return { paths, ids }
}

function removeTolerant(remove: () => void): void {
  try {
    remove()
  } catch (error) {
    if (!isNotFound(error)) throw error
  }
}

/**
 * Apply a {@link ProjectsGCPlan}. A dry run (`apply: false`) removes nothing and reports every candidate.
 * Applying first requires `options.owner` to own the projects root, then re-checks protection before
 * EACH removal (pointer, `protectedIds`, live writer) and refuses what changed since the plan.
 *
 * @throws {CollectorRootNotOwnedError} when applying and the root is not owned by `options.owner`.
 * @throws {CollectorRootError} when the ownership marker cannot be read.
 */
export async function runProjectsGC(
  plan: ProjectsGCPlan,
  options: RunProjectsGCOptions,
): Promise<RunProjectsGCResult> {
  const removed: string[] = []
  const refused: { target: string; reason: string }[] = []
  const errors: { target: string; message: string }[] = []

  if (!options.apply) {
    return { dryRun: true, removed: plan.candidates.map((c) => c.target), refused, errors }
  }

  const actual = collectorRootOwner(plan.projectsRoot)
  if (options.owner === undefined || actual?.app !== options.owner.app) {
    throw new CollectorRootNotOwnedError(
      plan.projectsRoot,
      options.owner?.app ?? '(none given)',
      actual?.app,
    )
  }

  const fs = options.fs ?? defaultFs
  const remove = options.removeFromRegistry ?? ((id: string) => Agent.delete(id))
  const touched = new Set<string>()

  for (const candidate of plan.candidates) {
    const { target, project } = candidate
    // Protection is re-read per candidate: a pointer can change while an earlier removal awaits.
    let now: ReturnType<typeof protectionNow>
    try {
      now = protectionNow(plan, options, fs)
    } catch (error) {
      refused.push({ target, reason: `protection cannot be established: ${messageOf(error)}` })
      continue
    }
    let guarded: string | undefined // the transcript whose writer matters
    if (candidate.kind === 'transcript') guarded = target
    else if (candidate.kind === 'writer-lock' || candidate.kind === 'lock-directory') {
      const suffix = candidate.kind === 'writer-lock' ? '.writer.lock' : '.lock'
      guarded = join(dirname(target), basename(target).slice(0, -suffix.length))
    }
    const reason =
      now.paths.get(target) ??
      (candidate.kind === 'registry' ? now.ids.get(candidate.sessionId ?? target) : undefined) ??
      (guarded !== undefined ? now.paths.get(guarded) : undefined)
    if (reason !== undefined) {
      refused.push({ target, reason: `changed since the plan: ${reason}` })
      continue
    }
    if (guarded !== undefined) {
      let writer: boolean
      try {
        writer = fs.hasLiveWriter(guarded)
      } catch {
        writer = true
      }
      if (writer) {
        refused.push({ target, reason: 'changed since the plan: a live writer holds the session' })
        continue
      }
    }

    try {
      if (candidate.sessionId !== undefined) {
        try {
          await awaitRegistryRemoval(
            remove(candidate.sessionId),
            candidate.sessionId,
            options.registryTimeoutMs,
          )
        } catch (error) {
          errors.push({ target, message: `registry removal failed, kept: ${messageOf(error)}` })
          continue
        }
      }
      if (candidate.kind === 'lock-directory')
        removeTolerant(() => {
          rmdirSync(target)
        })
      else if (candidate.kind !== 'registry')
        removeTolerant(() => {
          unlinkSync(target)
        })
      removed.push(target)
      touched.add(project)
    } catch (error) {
      errors.push({ target, message: messageOf(error) })
    }
  }

  // A project directory the removals left empty goes too; a non-empty one is left alone.
  for (const project of touched) {
    const dir = join(plan.projectsRoot, project)
    try {
      if (readdirSync(dir).length === 0) {
        removeTolerant(() => {
          rmdirSync(dir)
        })
        removed.push(dir)
      }
    } catch (error) {
      if (!isNotFound(error)) errors.push({ target: dir, message: messageOf(error) })
    }
  }

  return { dryRun: false, removed, refused, errors }
}
