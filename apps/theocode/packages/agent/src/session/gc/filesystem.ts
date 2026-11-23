import { readdirSync, statSync, openSync, readSync, closeSync } from 'node:fs'
import { join } from 'node:path'

import { Agent } from '@theokit/agents'
import { sessionHasWriter } from '@theokit/agents/persistence'
import {
  classifyProjects,
  planProjectsGC,
  projectsRoot,
  runProjectsGC,
  type FsSeam,
  type ProjectsGCKind,
  type ProjectsGCPlan,
} from '@theokit/agents/session'

import { listAgents } from '../agent-list.js'
import { claimDefaultRoot } from './root-claim.js'
import { OWNERSHIP_MARKER, OWNER, THEOCODE_MARKER, rootIsOurs } from './root-ownership.js'

/** The retention defaults of `sessions gc --all-projects`. */
const KEEP_PER_PROJECT = 10
const DEFAULT_WINDOW_DAYS = 30

/** The artifact kinds this product reports, which are not the framework's names. */
type CollectableKind = 'transcript' | 'lock-file' | 'lock-directory' | 'tmp' | 'registry'

interface AllCandidate {
  project: string
  kind: CollectableKind
  target: string
  ageDays: number
}

export interface AllPlan {
  candidates: AllCandidate[]
  /** Projects left whole: nothing in them is collectable, or they could not be classified. */
  kept: string[]
  touchedProjects: string[]
  liveCwds: string[]
  totalByKind: Record<CollectableKind, number>
  errors: string[]
  /** The framework plan this one was adapted from, handed back to `runAllProjectsOnDisk`. */
  framework?: ProjectsGCPlan
}

export interface AllResult {
  dryRun: boolean
  removed: string[]
  errors: string[]
}

const FIRST_LINE_CAP = 64 * 1024

/**
 * B-054 — the whole `--all-projects` sweep shares ONE filesystem budget.
 *
 * Counts filesystem OPERATIONS now, not DFS nodes: the depth and per-project node ceilings went with
 * the oracle, because `classifyProjects` resolves a project by reading a transcript's recorded cwd
 * rather than by walking the disk. The measured cost is ~2.54 operations per project, so 200 000
 * covers ~78 700 projects at that rate — 5.9x the 13 269 that motivated the ticket, not the
 * order of magnitude an earlier version of this sentence claimed. What the sweep
 * cannot classify within it is UNDETERMINED and therefore KEPT (B-020) — the safe direction on the
 * only path that deletes user data.
 */
const SWEEP_FS_BUDGET = 200_000

const io: FsSeam & { readText: (path: string) => string } = {
  // Capped: callers want a first line (a transcript header) or a one-line pointer. A header longer
  // than the cap fails to parse and keeps its project whole.
  readText(file) {
    const fd = openSync(file, 'r')
    try {
      const buf = Buffer.alloc(FIRST_LINE_CAP)
      return buf.subarray(0, readSync(fd, buf, 0, FIRST_LINE_CAP, 0)).toString('utf8')
    } finally {
      closeSync(fd)
    }
  },
  listEntries: (dir) => readdirSync(dir),
  firstLine(file) {
    const fd = openSync(file, 'r')
    try {
      const buf = Buffer.alloc(FIRST_LINE_CAP)
      const bytesRead = readSync(fd, buf, 0, FIRST_LINE_CAP, 0)
      const text = buf.subarray(0, bytesRead).toString('utf8')
      const nl = text.indexOf('\n')
      return nl >= 0 ? text.slice(0, nl) : text
    } finally {
      closeSync(fd)
    }
  },
  exists(path) {
    try {
      return statSync(path).isDirectory()
    } catch (err) {
      // B-020 — ENOENT is the only errno that means "it is not there". EACCES on a non-traversable
      // parent, ENOTDIR mid-path or EMFILE under a wide sweep all leave the directory in place, and
      // reporting those as absence classified a live project DEAD, which empties every guard.
      return (err as NodeJS.ErrnoException).code === 'ENOENT' ? false : undefined
    }
  },
}

interface CliOptions {
  apply?: boolean
  keepLast?: number
  maxAgeDays?: number
  projectsRoot?: string
}

const KIND_OF: Record<ProjectsGCKind, CollectableKind> = {
  transcript: 'transcript',
  'writer-lock': 'lock-file',
  'lock-directory': 'lock-directory',
  temp: 'tmp',
  registry: 'registry',
}

function emptyByKind(): Record<CollectableKind, number> {
  return { transcript: 0, 'lock-file': 0, 'lock-directory': 0, tmp: 0, registry: 0 }
}

/** The encoded project directories under `root`. Absent root lists nothing rather than throwing. */
function listProjectDirs(root: string): string[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
  } catch {
    // Only the kept-count needs this list; the framework lists the root itself and REPORTS a root
    // it could not read, so "could not look" is never shown as "nothing to collect".
    return []
  }
}

function refusedPlan(root: string): AllPlan {
  // REFUSED, and loudly: enumerating a directory nobody marked and reporting a clean sweep was
  // measured on 2026-09-04 as `DRY-RUN — 0 would remove; 0 kept` over an empty root, exit 0.
  return {
    candidates: [],
    kept: [],
    touchedProjects: [],
    liveCwds: [],
    totalByKind: {} as AllPlan['totalByKind'],
    errors: [
      `${root}: this collector did not create this directory and will not delete inside it — ` +
        `write ${OWNERSHIP_MARKER} beside it to claim it deliberately`,
    ],
  }
}

export async function planAllProjectsOnDisk(opts: CliOptions = {}): Promise<AllPlan> {
  const root = opts.projectsRoot ?? projectsRoot()
  claimDefaultRoot(root)
  if (!rootIsOurs(root)) return refusedPlan(root)
  // Enumerated ONCE: the classifier takes the whole list against one budget.
  const projects = listProjectDirs(root)
  const framework = await planProjectsGC({
    projectsRoot: root,
    keepLast: opts.keepLast ?? KEEP_PER_PROJECT,
    maxAgeDays: opts.maxAgeDays ?? DEFAULT_WINDOW_DAYS,
    classify: (names) => sweepClassify(root, names),
    // This product cannot enumerate its cwds: the cwds its transcripts record are the whole class.
    cwdCoverage: 'transcripts',
    // It applies retention alone to a project whose cwd is gone.
    deadProjects: 'keep-last',
    listRegistry: async (cwd) =>
      (await listAgents(cwd)).map((a) => ({
        id: a.agentId,
        archived: a.archived,
        lastModified: a.lastModified,
      })),
    fs: {
      readdir: (dir) => readdirSync(dir),
      stat: (path) => {
        const s = statSync(path)
        return { isDirectory: s.isDirectory(), mtimeMs: s.mtimeMs }
      },
      readFile: (path) => io.readText(path),
      hasLiveWriter: (transcript) => sessionHasWriter(transcript),
    },
  })
  return adapt(framework, projects)
}

function adapt(framework: ProjectsGCPlan, projects: readonly string[]): AllPlan {
  const totalByKind = emptyByKind()
  const candidates = framework.candidates.map((c): AllCandidate => {
    const kind = KIND_OF[c.kind]
    totalByKind[kind] += 1
    return { project: c.project, kind, target: c.target, ageDays: c.ageDays }
  })
  const touched = new Set(framework.touchedProjects)
  const failed = new Set(framework.errors.map((e) => e.project))
  return {
    candidates,
    kept: projects.filter((p) => !touched.has(p) && !failed.has(p)),
    touchedProjects: framework.touchedProjects.map((p) => join(framework.projectsRoot, p)),
    liveCwds: [...framework.liveCwds],
    totalByKind,
    errors: framework.errors.map((e) =>
      e.project === '' ? e.message : `${e.project}: ${e.message}`,
    ),
    framework,
  }
}

/**
 * The framework's sweep classifier over ONE shared budget (B-054), reading each transcript's
 * recorded cwd. There is no candidate pool: a project it cannot place is UNDETERMINED and kept
 * whole (B-020) — the safe direction on the only path that deletes user data.
 */
function sweepClassify(root: string, projects: readonly string[]) {
  return classifyProjects(projects, {
    projectsRoot: root,
    candidatePaths: () => [],
    budget: SWEEP_FS_BUDGET,
    fs: io,
  })
}

export async function runAllProjectsOnDisk(
  plan: AllPlan,
  opts: CliOptions = {},
): Promise<AllResult> {
  const apply = opts.apply === true
  if (plan.framework === undefined) return { dryRun: !apply, removed: [], errors: [] }
  const result = await runProjectsGC(plan.framework, {
    apply,
    owner: OWNER,
    existingMarker: THEOCODE_MARKER,
    removeFromRegistry: (id) => Agent.delete(id),
    fs: {
      readFile: (path) => io.readText(path),
      hasLiveWriter: (transcript) => sessionHasWriter(transcript),
    },
  })
  return {
    dryRun: result.dryRun,
    removed: [...result.removed],
    errors: [
      ...result.refused.map((r) => `${r.target}: refused — ${r.reason}`),
      ...result.errors.map((e) => `${e.target}: ${e.message}`),
    ],
  }
}

const LABEL: Record<CollectableKind, string> = {
  transcript: 'transcript',
  registry: 'registry entry',
  'lock-file': 'orphaned lock (file)',
  'lock-directory': 'orphaned lock (directory)',
  tmp: 'interrupted temporary',
}

export function formatReport(plan: AllPlan, result: AllResult): string[] {
  const lines: string[] = []
  lines.push(
    result.dryRun
      ? 'DRY-RUN — nothing was removed; use --apply to execute'
      : `APPLIED — ${String(result.removed.length)} artifact(s) removed`,
  )
  lines.push('')
  lines.push('by kind:')
  for (const [kind, n] of Object.entries(plan.totalByKind) as [CollectableKind, number][]) {
    if (n > 0) lines.push(`  ${LABEL[kind].padEnd(24)} ${String(n).padStart(7)}`)
  }
  const perProject = new Map<string, number>()
  for (const c of plan.candidates) perProject.set(c.project, (perProject.get(c.project) ?? 0) + 1)
  lines.push('')
  lines.push(
    `projects: ${String(perProject.size)} with candidates, ${String(plan.kept.length)} kept whole`,
  )
  for (const e of plan.errors) lines.push(`  ! ${e}`)
  for (const e of result.errors) lines.push(`  ! ${e}`)
  if (plan.candidates.length === 0) lines.push('nothing to collect')
  return lines
}
