import { readdirSync, readFileSync, statSync } from 'node:fs'

import { Agent } from '@theokit/agents'
import { sessionHasWriter } from '@theokit/agents/persistence'
import {
  claimCollectorRoot,
  planProjectsGC,
  projectsRoot,
  runProjectsGC,
  type ProjectsGCFs,
  type ProjectsGCKind,
  type ProjectsGCPlan,
  type RunProjectsGCResult,
} from '@theokit/agents/session'

import { listAgents } from '../agent-list.js'
import { gcProtectedIds } from './pointer.js'
import { claimDefaultRoot } from './root-claim.js'
import { OWNERSHIP_MARKER, rootIsOurs } from './root-ownership.js'

/**
 * TheoCode's wiring of the framework's all-projects collector (`planProjectsGC` / `runProjectsGC`).
 *
 * The planning, the protection rules and the re-check before each removal are the framework's. What
 * is TheoCode's: which root it may sweep (its own consent marker, `root-ownership.ts`), where its
 * live-session pointer lives (`gcProtectedIds`), its registry listing, and the report wording.
 */

/** The framework's owner name for the root marker, written only after TheoCode's own marker passed. */
const COLLECTOR_APP = 'theocode'

/** Retention defaults: ten newest per project, thirty days. */
const DEFAULT_KEEP_LAST = 10
const DEFAULT_WINDOW_DAYS = 30

export interface AllProjectsOptions {
  apply?: boolean
  keepLast?: number
  maxAgeDays?: number
  projectsRoot?: string
  /** Test seams; production leaves them unset. */
  now?: number
  listRegistry?: (
    cwd: string,
  ) => Promise<readonly { id: string; archived?: boolean; lastModified?: number }[]>
  hasLiveWriter?: (transcript: string) => boolean
  removeFromRegistry?: (sessionId: string) => unknown
}

export type AllPlan = ProjectsGCPlan
export type AllResult = RunProjectsGCResult

const realFs: ProjectsGCFs = {
  readdir: (dir) => readdirSync(dir),
  stat: (path) => {
    const s = statSync(path)
    return { isDirectory: s.isDirectory(), mtimeMs: s.mtimeMs }
  },
  readFile: (path) => readFileSync(path, 'utf8'),
  hasLiveWriter: (transcript) => sessionHasWriter(transcript),
}

const protectedIds = (cwd: string): ReadonlyMap<string, string> => gcProtectedIds(cwd)()

export async function planAllProjectsOnDisk(opts: AllProjectsOptions = {}): Promise<AllPlan> {
  const root = opts.projectsRoot ?? projectsRoot()
  claimDefaultRoot(root)
  if (!rootIsOurs(root)) {
    // REFUSED, loudly: an empty plan with the reason, never a clean-looking sweep of a directory
    // nobody marked.
    return {
      projectsRoot: root,
      candidates: [],
      kept: [],
      touchedProjects: [],
      liveCwds: [],
      countByKind: { transcript: 0, 'writer-lock': 0, 'lock-directory': 0, temp: 0, registry: 0 },
      errors: [
        {
          project: '',
          message:
            `${root}: this collector did not create this directory and will not delete inside it — ` +
            `write ${OWNERSHIP_MARKER} beside it to claim it deliberately`,
        },
      ],
    }
  }
  return planProjectsGC({
    projectsRoot: root,
    keepLast: opts.keepLast ?? DEFAULT_KEEP_LAST,
    maxAgeDays: opts.maxAgeDays ?? DEFAULT_WINDOW_DAYS,
    ...(opts.now === undefined ? {} : { now: opts.now }),
    listRegistry:
      opts.listRegistry ??
      (async (cwd) =>
        (await listAgents(cwd)).map((a) => ({
          id: a.agentId,
          archived: a.archived,
          lastModified: a.lastModified,
        }))),
    ...(opts.hasLiveWriter === undefined
      ? {}
      : { fs: { ...realFs, hasLiveWriter: opts.hasLiveWriter } }),
    protectedIds,
    // Every cwd TheoCode can name for a project is the one its transcripts record; a colliding cwd
    // with a registry and no transcript of its own is not enumerable, and was never consulted.
    candidateCwds: () => [],
    candidateCwdsComplete: true,
  })
}

export async function runAllProjectsOnDisk(
  plan: AllPlan,
  opts: AllProjectsOptions = {},
): Promise<AllResult> {
  if (opts.apply === true) {
    // The framework refuses to apply under a root it has no marker for. TheoCode's own marker was
    // checked at plan time and is re-checked here, so the framework's is written only for a root
    // TheoCode owns.
    if (!rootIsOurs(plan.projectsRoot)) {
      return {
        dryRun: false,
        removed: [],
        refused: [],
        errors: [
          {
            target: plan.projectsRoot,
            message: `not owned by this collector (${OWNERSHIP_MARKER})`,
          },
        ],
      }
    }
    claimCollectorRoot(plan.projectsRoot, { app: COLLECTOR_APP })
  }
  return runProjectsGC(plan, {
    apply: opts.apply === true,
    owner: { app: COLLECTOR_APP },
    removeFromRegistry: opts.removeFromRegistry ?? ((id) => Agent.delete(id)),
    protectedIds,
    ...(opts.hasLiveWriter === undefined
      ? {}
      : { fs: { readFile: realFs.readFile, hasLiveWriter: opts.hasLiveWriter } }),
  })
}

/** Every plan, refusal and removal error as one line each, for the exit code and `--json`. */
export function reportErrors(plan: AllPlan, result: AllResult): string[] {
  return [
    ...plan.errors.map((e) => (e.project === '' ? e.message : `${e.project}: ${e.message}`)),
    ...result.refused.map((r) => `${r.target}: refused — ${r.reason}`),
    ...result.errors.map((e) => `${e.target}: ${e.message}`),
  ]
}

/** Projects the plan left whole: the framework's `kept` also lists single entries kept inside a project. */
export function keptWholeCount(plan: AllPlan): number {
  return new Set(plan.kept.filter((k) => k.reason.includes('kept whole')).map((k) => k.project))
    .size
}

const LABEL: Record<ProjectsGCKind, string> = {
  transcript: 'transcript',
  registry: 'registry entry',
  'writer-lock': 'orphaned lock (file)',
  'lock-directory': 'orphaned lock (directory)',
  temp: 'interrupted temporary',
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
  for (const [kind, n] of Object.entries(plan.countByKind) as [ProjectsGCKind, number][]) {
    if (n > 0) lines.push(`  ${LABEL[kind].padEnd(24)} ${String(n).padStart(7)}`)
  }
  const projects = new Set(plan.candidates.map((c) => c.project))
  lines.push('')
  lines.push(
    `projects: ${String(projects.size)} with candidates, ${String(keptWholeCount(plan))} kept whole`,
  )
  for (const e of reportErrors(plan, result)) lines.push(`  ! ${e}`)
  if (plan.candidates.length === 0) lines.push('nothing to collect')
  return lines
}
