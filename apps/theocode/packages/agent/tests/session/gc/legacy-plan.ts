/**
 * Test-only adapter: drives the framework planner (`planProjectsGC`) with the injectable seams the
 * deleted in-house planner took, so the guard cases written against that planner keep running
 * against the code that replaced it.
 */

import { encodeProjectDir, transcriptRoot } from '@theokit/agents/persistence'
import { join } from 'node:path'

import { planProjectsGC, type ProjectsGCPlan } from '@theokit/agents/session'

export interface ProjectEntry {
  name: string
  isDirectory: boolean
  mtimeMs?: number
}

type Verdict =
  | { state: 'ALIVE'; cwd: string }
  | { state: 'DEAD'; cwd: string }
  | { state: 'UNDETERMINED'; reason: string }

export interface LegacyOptions {
  projectsRoot?: string
  now?: () => number
  keepLast?: number
  maxAgeDays?: number
  listProjects: () => string[]
  listProject: (project: string) => ProjectEntry[]
  classify: (project: string) => Verdict
  listRegistry: (
    cwd: string,
  ) => Promise<{ agentId: string; archived?: boolean; lastModified?: number }[]>
  hasLiveWriter: (transcriptPath: string) => boolean
  readPointer: (cwd: string) => string | undefined
}

export interface LegacyPlan {
  candidates: ProjectsGCPlan['candidates'][number][]
  kept: string[]
  liveCwds: string[]
  errors: string[]
  framework: ProjectsGCPlan
}

const SENTINEL = 'zz-quota-sentinel.jsonl'
const enoent = (): Error => Object.assign(new Error('ENOENT'), { code: 'ENOENT' })

/**
 * The names the framework sees. It attributes a project by the cwd its transcripts record, and the
 * directory name must be that cwd's encoding. Test project names are arbitrary, so each is presented
 * under the encoding of the cwd its verdict names, and mapped back in the result.
 */
class Names {
  readonly verdictOf = new Map<string, Verdict>()
  private readonly alias = new Map<string, string>()
  private readonly original = new Map<string, string>()

  constructor(private readonly opts: LegacyOptions) {}

  list(): string[] {
    const names = this.opts.listProjects()
    for (const name of names) {
      const raw = this.opts.classify(name)
      // A verdict without a cwd (tests that do not care) is given one derived from the name.
      const v: Verdict =
        raw.state !== 'UNDETERMINED' && typeof raw.cwd !== 'string'
          ? { ...raw, cwd: `/${name}` }
          : raw
      this.verdictOf.set(name, v)
      const shown = v.state === 'UNDETERMINED' ? name : encodeProjectDir(v.cwd)
      this.alias.set(name, shown)
      this.original.set(shown, name)
    }
    return names.map((n) => this.alias.get(n) ?? n)
  }

  back(shown: string): string {
    return this.original.get(shown) ?? shown
  }

  verdict(shown: string): Verdict | undefined {
    return this.verdictOf.get(this.back(shown))
  }
}

function classifyFor(names: Names) {
  return (shown: readonly string[]) =>
    new Map(
      shown.map((name) => {
        const v = names.verdict(name) as Verdict
        return [
          name,
          v.state === 'UNDETERMINED'
            ? { liveness: 'undetermined' as const, reason: v.reason }
            : {
                liveness: v.state === 'ALIVE' ? ('alive' as const) : ('dead' as const),
                cwd: v.cwd,
              },
        ] as const
      }),
    ) as never
}

function fsFor(
  root: string,
  names: Names,
  opts: LegacyOptions,
  entriesOf: (p: string) => ProjectEntry[],
) {
  const projectOf = (path: string): string => path.slice(root.length + 1).split('/')[0] ?? ''
  const cwdOf = (shown: string): string | undefined => {
    const v = names.verdict(shown)
    return v !== undefined && v.state !== 'UNDETERMINED' ? v.cwd : undefined
  }
  return {
    readdir: (dir: string) =>
      dir === root ? names.list() : entriesOf(dir.slice(root.length + 1)).map((e) => e.name),
    stat: (path: string) => {
      const [project, name] = path.slice(root.length + 1).split('/')
      if (name === undefined) return { isDirectory: true }
      const e = entriesOf(project ?? '').find((x) => x.name === name)
      if (e === undefined) throw enoent()
      return {
        isDirectory: e.isDirectory,
        ...(e.mtimeMs === undefined ? {} : { mtimeMs: e.mtimeMs }),
      }
    },
    readFile: (path: string) => {
      const cwd = cwdOf(projectOf(path))
      if (path.endsWith('.jsonl') && cwd !== undefined) return `${JSON.stringify({ cwd })}\n`
      // The framework's own pointer: `<root>/<encoded cwd>/last-session`.
      const id =
        path.endsWith('/last-session') && cwd !== undefined ? opts.readPointer(cwd) : undefined
      if (id === undefined) throw enoent()
      return id
    },
    hasLiveWriter: (t: string) => opts.hasLiveWriter(t),
  }
}

function legacyResult(framework: ProjectsGCPlan, names: Names): LegacyPlan {
  return {
    candidates: framework.candidates
      .filter((c) => !c.target.endsWith(SENTINEL))
      .map((c) => {
        const project = names.back(c.project)
        return { ...c, project, target: c.target.replace(`/${c.project}/`, `/${project}/`) }
      }),
    kept: framework.kept.map((k) => names.back(k.project)),
    errors: framework.errors.map((e) =>
      e.project === '' ? e.message : `${names.back(e.project)}: ${e.message}`,
    ),
    liveCwds: [...framework.liveCwds],
    framework,
  }
}

export async function planSessionGCAllProjects(opts: LegacyOptions): Promise<LegacyPlan> {
  // Protection is by the SDK's own path, `<transcript root>/projects/<encoded cwd>/<hashed name>`.
  const root = join(opts.projectsRoot ?? transcriptRoot(), 'projects')
  const names = new Names(opts)
  // The framework refuses `keepLast` below 1. The retired planner accepted 0 ("no quota"); the
  // equivalent here is one slot spent on a fresh sentinel, which is never collectable and is the
  // newest entry, so it takes the slot and every real entry is judged by age alone.
  const noQuota = (opts.keepLast ?? 10) < 1
  const entriesOf = (project: string): ProjectEntry[] => {
    const real = opts.listProject(names.back(project))
    return noQuota
      ? [...real, { name: SENTINEL, isDirectory: false, mtimeMs: opts.now?.() ?? Date.now() }]
      : real
  }
  const framework = await planProjectsGC({
    projectsRoot: root,
    keepLast: noQuota ? 1 : (opts.keepLast ?? 10),
    maxAgeDays: opts.maxAgeDays ?? 30,
    ...(opts.now ? { now: opts.now() } : {}),
    cwdCoverage: 'transcripts',
    deadProjects: 'keep-last',
    listRegistry: async (cwd) =>
      (await opts.listRegistry(cwd)).map((a) => ({
        id: a.agentId,
        ...(a.archived === undefined ? {} : { archived: a.archived }),
        ...(a.lastModified === undefined ? {} : { lastModified: a.lastModified }),
      })),
    classify: classifyFor(names),
    fs: fsFor(root, names, opts, entriesOf),
  })
  return legacyResult(framework, names)
}
