import {
  existsSync,
  readdirSync,
  statSync,
  openSync,
  readSync,
  closeSync,
  promises as fsp,
} from 'node:fs'
import { join } from 'node:path'

import { Agent } from '@theokit/agents'
import { sessionHasWriter } from '@theokit/agents/persistence'
import { classifyProjects, projectsRoot, type FsSeam } from '@theokit/agents/session'

import { listAgents } from '../agent-list.js'
import { runSessionGCAllProjects } from './all-sessions-apply.js'
import {
  planSessionGCAllProjects,
  type Liveness,
  type ProjectEntry,
  type CollectableKind,
  type AllPlan,
  type AllResult,
} from './all-sessions.js'
import { readPointerId } from './pointer.js'
import { claimDefaultRoot } from './root-claim.js'
import { OWNERSHIP_MARKER, rootIsOurs } from './root-ownership.js'

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

const io: FsSeam = {
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

function listRealProject(root: string, project: string): ProjectEntry[] {
  const dir = join(root, project)
  return readdirSync(dir, { withFileTypes: true }).map((e) => {
    let mtimeMs: number | undefined
    try {
      mtimeMs = statSync(join(dir, e.name)).mtimeMs
    } catch {
      // B-020 — left UNDEFINED, which the planner reads as "no age to compare" and never collects.
      //
      // This used to be `mtimeMs = 0`, justified by assuming the only cause is the node vanishing
      // between `readdir` and `stat`. That reasoning does not hold for EACCES, EMFILE (plausible
      // precisely here, since the collector stats every entry of every project in one pass), ELOOP
      // or a transient EIO: those leave the file on disk while dating it to 1970. `ageDays` then
      // computed as ~20 000 and cleared every window — and mtime 0 also sorts LAST, so `keepLast`,
      // which slices the newest, could not protect it either.
    }
    return { name: e.name, isDirectory: e.isDirectory(), mtimeMs }
  })
}

interface CliOptions {
  apply?: boolean
  keepLast?: number
  maxAgeDays?: number
  projectsRoot?: string
}

async function listProjectRegistry(cwd: string): Promise<Awaited<ReturnType<typeof listAgents>>> {
  return listAgents(cwd)
}

/** The encoded project directories under `root`. Absent root lists nothing rather than throwing. */
function listProjectDirs(root: string): string[] {
  return existsSync(root)
    ? readdirSync(root, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
    : []
}

export async function planAllProjectsOnDisk(opts: CliOptions = {}): Promise<AllPlan> {
  const root = opts.projectsRoot ?? projectsRoot()
  claimDefaultRoot(root)
  if (!rootIsOurs(root)) {
    // REFUSED, and loudly. The alternative is what this used to do: enumerate a directory nobody
    // marked, find nothing it recognises, and report a clean sweep — measured 2026-09-04 as
    // `DRY-RUN — 0 would remove; 0 kept` over an empty root, exit 0.
    //
    // An empty plan is the honest shape: nothing IS a candidate. `errors` carries the reason so the
    // operator reads a refusal rather than inferring one from a zero.
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
  // Enumerated ONCE and shared: the framework's sweep classifies the whole list in one call against
  // one budget, so it needs the names up front — and reading the directory twice could hand the two
  // halves different sets on a tree that changes under them.
  const projects = listProjectDirs(root)
  return planSessionGCAllProjects({
    projectsRoot: root,
    ...(opts.keepLast !== undefined ? { keepLast: opts.keepLast } : {}),
    ...(opts.maxAgeDays !== undefined ? { maxAgeDays: opts.maxAgeDays } : {}),
    listProjects: () => projects,
    listProject: (p) => listRealProject(root, p),
    classify: sweepClassifier(root, projects),
    listRegistry: (cwd) => listProjectRegistry(cwd),
    hasLiveWriter: (transcript) => sessionHasWriter(transcript),
    readPointer: (cwd) => readPointerId(cwd),
  })
}

/**
 * `classify`, backed by the framework's sweep.
 *
 * What this replaces is 188 lines of oracle that lived here and answered the same question. The
 * shared budget it was built for is now structural rather than threaded by hand: `classifyProjects`
 * takes the whole list and spends ONE budget across it, so the per-project ceiling cannot multiply
 * into the ~64M readdir calls that motivated B-054.
 *
 * ONE capability is not carried over, and it is recorded rather than glossed: the deleted oracle
 * searched the filesystem from `/` for a project whose transcript held no cwd. The framework takes a
 * `candidatePaths` pool instead, and this product has none to give — enumerating the disk is what
 * the framework's design rejects. Measured on a real tree of 13 624 projects before the swap: 5
 * verdicts change, every one of them from a decided verdict to `undetermined`, which the collector
 * KEEPS. So the loss costs stale directories surviving, never a live project deleted — the safe
 * direction, and the only one that matters on a path that unlinks user data (B-020).
 */
function sweepClassifier(root: string, projects: readonly string[]): (project: string) => Liveness {
  const verdicts = classifyProjects(projects, {
    projectsRoot: root,
    candidatePaths: () => [],
    budget: SWEEP_FS_BUDGET,
    fs: io,
  })
  return (project) => toLiveness(verdicts.get(project))
}

/**
 * Framework verdict → the GC's vocabulary.
 *
 * `alive` without a `cwd` is treated as UNDETERMINED rather than trusted. The framework types `cwd`
 * as optional because `undetermined` has none, so nothing at the type level guarantees it here — and
 * the GC uses that path to consult the registry and the pointer. Fail-safe: a project we cannot
 * place is one we keep.
 */
function toLiveness(
  verdict: { liveness: string; reason: string; cwd?: string } | undefined,
): Liveness {
  if (verdict === undefined)
    return { state: 'UNDETERMINED', reason: 'not classified in this sweep' }
  if (verdict.liveness === 'alive') {
    return verdict.cwd === undefined
      ? { state: 'UNDETERMINED', reason: `alive but no cwd resolved: ${verdict.reason}` }
      : { state: 'ALIVE', cwd: verdict.cwd }
  }
  if (verdict.liveness === 'dead') {
    return verdict.cwd === undefined ? { state: 'DEAD' } : { state: 'DEAD', cwd: verdict.cwd }
  }
  return { state: 'UNDETERMINED', reason: verdict.reason }
}

export async function runAllProjectsOnDisk(
  plan: AllPlan,
  opts: CliOptions = {},
): Promise<AllResult> {
  const root = opts.projectsRoot ?? projectsRoot()
  return runSessionGCAllProjects(plan, {
    ...(opts.apply === true ? { apply: true } : {}),
    unlink: (path) => fsp.unlink(path),
    rmdir: (path) => fsp.rmdir(path),
    deleteAgent: (id) => Agent.delete(id),
    hasLiveWriter: (transcript) => sessionHasWriter(transcript),
    readPointer: (cwd) => readPointerId(cwd),
    listProject: (p) => {
      try {
        return listRealProject(root, p)
      } catch {
        return [{ name: '<unreadable>', isDirectory: false, mtimeMs: 0 }]
      }
    },
  })
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
