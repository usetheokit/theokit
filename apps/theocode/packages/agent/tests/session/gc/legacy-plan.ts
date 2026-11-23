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

export async function planSessionGCAllProjects(opts: LegacyOptions): Promise<LegacyPlan> {
  // Protection is by the SDK's own path, `<transcript root>/projects/<encoded cwd>/<hashed name>`.
  const root = join(opts.projectsRoot ?? transcriptRoot(), 'projects')
  // The framework attributes a project by the cwd its transcripts record, and the directory name
  // must be that cwd's encoding. Test project names are arbitrary, so each is presented under the
  // encoding of the cwd its verdict names, and mapped back in the result.
  const verdictOf = new Map<string, Verdict>()
  const alias = new Map<string, string>()
  const original = new Map<string, string>()
  const projects = (): string[] => {
    const names = opts.listProjects()
    for (const name of names) {
      const raw = opts.classify(name)
      // A verdict without a cwd (tests that do not care) is given one derived from the name.
      const v: Verdict =
        raw.state !== 'UNDETERMINED' && typeof raw.cwd !== 'string'
          ? { ...raw, cwd: `/${name}` }
          : raw
      verdictOf.set(name, v)
      const shown = v.state === 'UNDETERMINED' ? name : encodeProjectDir(v.cwd)
      alias.set(name, shown)
      original.set(shown, name)
    }
    return names.map((n) => alias.get(n) ?? n)
  }
  // The framework refuses `keepLast` below 1. The retired planner accepted 0 ("no quota"); the
  // equivalent here is one slot spent on a fresh sentinel, which is never collectable and is the
  // newest entry, so it takes the slot and every real entry is judged by age alone.
  const noQuota = (opts.keepLast ?? 10) < 1
  const SENTINEL = 'zz-quota-sentinel.jsonl'
  const entriesOf = (project: string): ProjectEntry[] => {
    const real = opts.listProject(original.get(project) ?? project)
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
    classify: (names) =>
      new Map(
        names.map((name) => {
          const v = verdictOf.get(original.get(name) ?? name) as Verdict
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
      ) as never,
    fs: {
      readdir: (dir) =>
        dir === root ? projects() : entriesOf(dir.slice(root.length + 1)).map((e) => e.name),
      stat: (path) => {
        const rel = path.slice(root.length + 1)
        const [project, name] = rel.split('/')
        if (name === undefined) return { isDirectory: true }
        const e = entriesOf(project ?? '').find((x) => x.name === name)
        if (e === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
        return {
          isDirectory: e.isDirectory,
          ...(e.mtimeMs === undefined ? {} : { mtimeMs: e.mtimeMs }),
        }
      },
      readFile: (path) => {
        if (path.endsWith('.jsonl')) {
          const project = path.slice(root.length + 1).split('/')[0] ?? ''
          const v = verdictOf.get(original.get(project) ?? project)
          if (v !== undefined && v.state !== 'UNDETERMINED')
            return `${JSON.stringify({ cwd: v.cwd })}\n`
        }
        // The framework's own pointer: `<root>/<encoded cwd>/last-session`.
        const shown = path.endsWith('/last-session')
          ? path.slice(root.length + 1).split('/')[0]
          : undefined
        const v = shown === undefined ? undefined : verdictOf.get(original.get(shown) ?? shown)
        const id =
          v !== undefined && v.state !== 'UNDETERMINED' ? opts.readPointer(v.cwd) : undefined
        if (id === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
        return id
      },
      hasLiveWriter: (t) => opts.hasLiveWriter(t),
    },
  })
  return {
    candidates: framework.candidates
      .filter((c) => !c.target.endsWith(SENTINEL))
      .map((c) => {
        const project = original.get(c.project) ?? c.project
        return { ...c, project, target: c.target.replace(`/${c.project}/`, `/${project}/`) }
      }),
    kept: framework.kept.map((k) => original.get(k.project) ?? k.project),
    errors: framework.errors.map((e) =>
      e.project === '' ? e.message : `${original.get(e.project) ?? e.project}: ${e.message}`,
    ),
    liveCwds: [...framework.liveCwds],
    framework,
  }
}
