import { basename } from 'node:path'

import { transcriptPath, transcriptRoot } from '@theokit/agents/persistence'

import {
  assertCollectionFloor,
  DEFAULT_WINDOW_DAYS,
} from './collection-window.js'

import { classifyEntry, type ArtifactKind } from '../artifacts.js'
import {
  registryNames,
  resolveGuards,
  type Liveness,
  type RegistryEntry,
} from './all-sessions-guards.js'
import { lockId, transcriptId } from './transcript-names.js'

// The guard half and the naming vocabulary live in their own modules (split when this file
// re-crossed the 400-line gate that motivated its first split); this module stays their public
// surface so importers keep one path.
export type { Liveness } from './all-sessions-guards.js'
export { LOCK_SUFFIX, transcriptId } from './transcript-names.js'

const KEEP_PER_PROJECT = 10

export interface ProjectEntry {
  name: string
  isDirectory: boolean
  /** B-020 — `undefined` when the entry could not be stat-ed. An entry with no age is never collected. */
  mtimeMs: number | undefined
}

export type CollectableKind = ArtifactKind | 'registry'

export interface AllCandidate {
  project: string
  kind: CollectableKind
  target: string
  id?: string
  ageDays: number
  inRegistry?: boolean
  /**
   * The SESSION id, when this candidate is a registered transcript.
   *
   * `id` is the transcript NAME — a hash of the session id under 5.x — and `Agent.delete` takes the
   * session id. The mapping is one-way (usetheokit/theokit-sdk#577), so the only moment the pair is
   * in hand is at plan time, where the registry supplies both. Carrying it is what lets the apply
   * phase call `deleteAgent` with something it can act on.
   */
  agentId?: string
}

export interface AllPlan {
  candidates: AllCandidate[]
  kept: string[]
  touchedProjects: string[]
  liveCwds: string[]
  totalByKind: Record<CollectableKind, number>
  errors: string[]
}

export interface PlanAllOptions {
  projectsRoot: string
  now?: () => number
  keepLast?: number
  maxAgeDays?: number
  listProjects: () => string[]
  listProject: (project: string) => ProjectEntry[]
  classify: (project: string) => Liveness
  listRegistry: (cwd: string) => Promise<RegistryEntry[]>
  hasLiveWriter: (transcriptPath: string) => boolean
  readPointer: (cwd: string) => string | undefined
}

export interface ApplyAllOptions {
  apply?: boolean
  unlink: (path: string) => Promise<void>
  rmdir: (path: string) => Promise<void>
  deleteAgent: (id: string) => Promise<void>
  readPointer: (cwd: string) => string | undefined
  // B-021 — REQUIRED, matching the sibling PlanAllOptions. Optional made the apply-phase TOCTOU
  // backstop opt-in, and backstopRefusal returned undefined outright when it was absent.
  hasLiveWriter: (transcriptPath: string) => boolean
  listProject?: (project: string) => ProjectEntry[]
}

export interface AllResult {
  dryRun: boolean
  removed: string[]
  errors: string[]
}

function emptyByKind(): Record<CollectableKind, number> {
  return { transcript: 0, 'lock-file': 0, 'lock-directory': 0, tmp: 0, registry: 0 }
}

/**
 * The project's entries, and its transcripts newest-first.
 *
 * Returns `undefined` when the directory could not be listed, having recorded the reason — one
 * unreadable project skips itself rather than aborting the sweep.
 *
 * Ordering is BY MTIME rather than by id, and the reason is a decision nobody wrote down until an
 * audit named it (SD-07.2). Session ids are random UUIDs handed out by the SDK
 * (`session-ops.ts:52`), so they carry no order at all: sorting by name would produce an arbitrary
 * permutation that LOOKS deterministic. The filesystem timestamp is the only ordering signal this
 * layer has, which is why `keepLast` has to reason about entries that cannot be `stat`ed — the whole
 * class of bug B-140 exists downstream of this choice.
 *
 * `localeCompare` is the tiebreaker so equal mtimes still yield a stable order.
 */
function listTranscripts(
  project: string,
  opts: PlanAllOptions,
  errors: string[],
): { entries: ProjectEntry[]; transcripts: ProjectEntry[] } | undefined {
  let entries: ProjectEntry[]
  try {
    entries = opts.listProject(project)
  } catch (err) {
    errors.push(`${project}: could not list — ${(err as Error).message}`)
    return undefined
  }

  const transcripts = entries
    .filter((e) => classifyEntry(e.name, e.isDirectory) === 'transcript')
    .sort(
      (a, b) => (b.mtimeMs ?? Infinity) - (a.mtimeMs ?? Infinity) || a.name.localeCompare(b.name),
    )
  return { entries, transcripts }
}

async function planOneProject(
  project: string,
  previewWindow: CollectionWindow,
  keepLast: number,
  opts: PlanAllOptions,
  plan: AllPlan,
): Promise<void> {
  const { candidates, kept, touchedProjects, liveCwds, errors, totalByKind } = plan
  const { maxAgeDays, now } = previewWindow
  const liveness = opts.classify(project)
  if (liveness.state === 'UNDETERMINED') {
    kept.push(project)
    return
  }

  const listed = listTranscripts(project, opts, errors)
  if (listed === undefined) return
  const { entries, transcripts } = listed

  const dir = `${opts.projectsRoot}/${project}`
  const idsOnDisk = new Set(transcripts.map((t) => transcriptId(t.name)))

  const guards = await resolveGuards(liveness, transcripts, keepLast, opts)
  if ('failedRead' in guards) {
    errors.push(`${project}: ${guards.failedRead} unavailable — project skipped`)
    return
  }
  const { protectedIds, registry } = guards
  if (liveness.state === 'ALIVE') liveCwds.push(liveness.cwd)
  // #102 — keyed by TRANSCRIPT name, because that is what `has(id)` is asked with further down
  // (`planTranscript`). Holding session ids here made `inRegistry` permanently false on this path,
  // so every registered transcript in every other project was reported as an orphan.
  // A DEAD project has no cwd to map against, and `resolveGuards` already returns an empty registry
  // for one — so the empty set is the same answer, arrived at without a cast.
  const idsInRegistry = registryNames(liveness, registry)

  let plannedSomething = false
  const recordCandidate = (c: AllCandidate): void => {
    candidates.push(c)
    totalByKind[c.kind] += 1
    plannedSomething = true
  }

  planOnDiskEntries(
    { project, dir, entries, protectedIds, idsOnDisk, idsInRegistry },
    { maxAgeDays, now },
    recordCandidate,
    opts.hasLiveWriter,
  )

  if (liveness.state === 'ALIVE') {
    planRegistryEntries(
      project,
      registry,
      idsOnDisk,
      (agentId) => [
        transcriptId(basename(transcriptPath(transcriptRoot(), liveness.cwd, agentId))),
        agentId,
      ],
      { maxAgeDays, now },
      recordCandidate,
    )
  }

  if (plannedSomething) touchedProjects.push(dir)
  else kept.push(project)
}

interface CollectionWindow {
  readonly maxAgeDays: number
  readonly now: () => number
}

interface ProjectState {
  readonly project: string
  readonly dir: string
  readonly entries: readonly ProjectEntry[]
  readonly protectedIds: ReadonlySet<string>
  readonly idsOnDisk: ReadonlySet<string>
  readonly idsInRegistry: ReadonlyMap<string, string>
}

/**
 * The entry's age in days when it is past the window, or `undefined` when it must not be collected.
 *
 * B-020 — an entry with no mtime has NO AGE, and the window is the primary guard on this path. It
 * used to arrive here as `mtimeMs = 0`, which computed to ~20 000 days and cleared every window.
 *
 * DO NOT delete this line because a mutation test survives it. Measured 2026-09-03: removing it
 * leaves every case green, because `now() - undefined` is NaN and `NaN > maxAgeDays` is false, so
 * the entry is spared anyway. The OUTCOME is covered — `fail-open.test.ts` asserts an unreadable
 * mtime produces no candidate — and what this line adds is that the sparing is INTENDED rather than
 * a property of NaN comparison that a later refactor could remove without noticing.
 *
 * This shape recurred three times in this release (here, `readLastRun`'s NaN branch, and the env
 * coercion guard) and only one of the three was independently observable. A surviving mutant is
 * evidence about the test, not about the code.
 */
function collectableAge(e: ProjectEntry, window: CollectionWindow): number | undefined {
  if (e.mtimeMs === undefined) return undefined
  const ageDays = (window.now() - e.mtimeMs) / 86_400_000
  return ageDays > window.maxAgeDays ? ageDays : undefined
}

function planOnDiskEntries(
  st: ProjectState,
  previewWindow: CollectionWindow,
  recordCandidate: (c: AllCandidate) => void,
  hasLiveWriter: (transcriptPath: string) => boolean,
): void {
  for (const e of st.entries) {
    const kind = classifyEntry(e.name, e.isDirectory)
    if (kind === undefined) continue
    const ageDays = collectableAge(e, previewWindow)
    if (ageDays === undefined) continue
    const target = `${st.dir}/${e.name}`
    const project = st.project

    switch (kind) {
      case 'transcript': {
        const candidate = planTranscript(e.name, { st, target, ageDays, hasLiveWriter })
        if (candidate !== undefined) recordCandidate(candidate)
        break
      }
      case 'lock-file':
      case 'lock-directory': {
        if (st.idsOnDisk.has(lockId(e.name))) continue
        recordCandidate({ project, kind, target, ageDays })
        break
      }
      case 'tmp':
        recordCandidate({ project, kind, target, ageDays })
        break
      default:
        assertNeverKind(kind)
    }
  }
}

/**
 * Decide whether a stale transcript may be collected, or `undefined` when it must be kept.
 *
 * Two independent guards, and they see different things. `protectedIds` covers the live-session
 * pointer, `keepLast` and the registry — all id-based. The writer lease covers a session whose
 * writer is alive but whose id none of those knows, which is precisely the case where the id-based
 * set is silent.
 */
function planTranscript(
  name: string,
  ctx: {
    st: ProjectState
    target: string
    ageDays: number
    hasLiveWriter: (transcriptPath: string) => boolean
  },
): AllCandidate | undefined {
  const id = transcriptId(name)
  if (ctx.st.protectedIds.has(id)) return undefined
  // B-003 — ask the SDK's cross-process lease, not just the mtime window. Before this, only mtime
  // freshness stood between a live transcript and unlink: a heuristic standing in for a lease the
  // caller had already wired and the plan phase never called.
  if (ctx.hasLiveWriter(ctx.target)) return undefined
  return {
    project: ctx.st.project,
    kind: 'transcript',
    target: ctx.target,
    id,
    ageDays: ctx.ageDays,
    inRegistry: ctx.st.idsInRegistry.has(id),
    agentId: ctx.st.idsInRegistry.get(id),
  }
}

function planRegistryEntries(
  project: string,
  registry: readonly RegistryEntry[],
  idsOnDisk: ReadonlySet<string>,
  namesOf: (agentId: string) => readonly string[],
  previewWindow: CollectionWindow,
  recordCandidate: (c: AllCandidate) => void,
): void {
  for (const entry of registry) {
    if (entry.archived === true) continue
    // #102 — `idsOnDisk` holds transcript NAMES. Asking it for a session id matched nothing, so the
    // sweep kept a transcript and collected the registry entry naming it. Both conventions are
    // checked because an upgraded machine carries 4.x names beside 5.x hashes.
    if (namesOf(entry.agentId).some((n) => idsOnDisk.has(n))) continue
    // B-020 — an entry with no date is not an old entry. `?? 0` dated it to 1970, which reads as
    // ~19 000 days and is collected on sight; the same coercion was removed for `mtimeMs` above.
    if (entry.lastModified === undefined) continue
    const ageDays = (previewWindow.now() - entry.lastModified) / 86_400_000
    if (ageDays <= previewWindow.maxAgeDays) continue
    recordCandidate({
      project,
      kind: 'registry',
      target: entry.agentId,
      id: entry.agentId,
      ageDays,
    })
  }
}

export async function planSessionGCAllProjects(opts: PlanAllOptions): Promise<AllPlan> {
  const maxAgeDays = opts.maxAgeDays ?? DEFAULT_WINDOW_DAYS
  assertCollectionFloor(maxAgeDays)
  const now = opts.now ?? Date.now
  const keepLast = opts.keepLast ?? KEEP_PER_PROJECT

  const candidates: AllCandidate[] = []
  const kept: string[] = []
  const touchedProjects: string[] = []
  const liveCwds: string[] = []
  const errors: string[] = []
  const totalByKind = emptyByKind()

  let projects: string[]
  try {
    projects = opts.listProjects()
  } catch (err) {
    // B-020 — an empty plan AND an empty error list is the shape the renderer prints as "nothing to
    // collect". "I found nothing" and "I could not look" are different facts, and swallowing this
    // reported the reassuring one.
    errors.push(`could not list projects — ${(err as Error).message}`)
    return { candidates, kept, touchedProjects, liveCwds, totalByKind, errors }
  }

  const plan: AllPlan = { candidates, kept, touchedProjects, liveCwds, totalByKind, errors }
  for (const project of projects) {
    await planOneProject(project, { maxAgeDays, now }, keepLast, opts, plan)
  }

  return { candidates, kept, touchedProjects, liveCwds, totalByKind, errors }
}

export function assertNeverKind(kind: never): never {
  throw new Error(`unhandled artifact shape: ${String(kind)}`)
}
