import { readdirSync, readFileSync, statSync, type Stats } from 'node:fs'
import { join } from 'node:path'

import { splitFrontmatter } from '../config/frontmatter.js'

import { EVERY_SURFACE, type CompatSurface } from './setting-sources-gate.js'

/** The tail of the workflows warning; `reportUnloadedSurfaces` prefixes it with the script list. */
export const WORKFLOWS_REFUSAL_REASON =
  `which this runtime does NOT ` +
  `execute. Every configuration surface it loads is data (commands, hooks, plugins, skills, ` +
  `subagents); a workflow file is code, and executing JavaScript found under a caller-supplied ` +
  `directory is a trust decision that belongs to you rather than to this library. The ` +
  `orchestration itself is supported: build the same pipeline with Workflow / agentStep / ` +
  `createSquad from @theokit/sdk, which you import explicitly.`

export interface ForeignSurfaceEntry {
  /** Folder name relative to the foreign root, e.g. `agents`. */
  readonly dir: string
  readonly state: 'read' | 'refused'
  /** What the surface's own loader would take. */
  readonly count: number
  /** Entries (relative to the foreign root) that exist and could not be read. */
  readonly unreadable: readonly string[]
  /** For `refused`, why. */
  readonly reason?: string
  /** Sorted names counted for `workflows`; used to rebuild the existing warning. */
  readonly names?: readonly string[]
}

type Kind = 'agent-md' | 'command-md' | 'agent-memory' | 'scripts' | 'plugin-bundles'

interface Folder {
  readonly dir: string
  readonly kind: Kind
}

/**
 * Every gate surface and the foreign folders it governs. Typed as a record over `CompatSurface`, so
 * a surface added to the gate fails the build here until its folders (possibly none) are declared.
 */
const SURFACE_FOLDERS: Record<CompatSurface, readonly Folder[]> = {
  subagents: [
    { dir: 'agents', kind: 'agent-md' },
    { dir: 'agent-memory', kind: 'agent-memory' },
  ],
  commands: [{ dir: 'commands', kind: 'command-md' }],
  plugins: [{ dir: 'plugins', kind: 'plugin-bundles' }],
  context: [],
  hooks: [],
  skills: [],
}

/** Folders no gate surface ever loads. */
const REFUSED_FOLDERS: readonly Folder[] = [{ dir: 'workflows', kind: 'scripts' }]

const SCRIPT_SUFFIXES = ['.js', '.mjs', '.cjs'] as const

interface Count {
  count: number
  unreadable: string[]
  names: string[]
}

/** `undefined` when the path does not exist; any other failure (EACCES, ELOOP...) propagates. */
function statIfPresent(p: string): Stats | undefined {
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- caller's project root plus fixed convention
    return statSync(p)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/** Read a file only when it is a regular file, so a FIFO or device can never block the inventory. */
function readRegularFile(p: string): string | undefined {
  if (!statIfPresent(p)?.isFile()) return undefined
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- same convention
  return readFileSync(p, 'utf8')
}

/** Each counter says whether the entry counts; it throws when the entry cannot be read. */
function countsAgentMd(abs: string, name: string): boolean {
  if (!name.endsWith('.md')) return false
  const raw = readRegularFile(join(abs, name))
  return raw?.replace(/^\uFEFF/, '').startsWith('---') === true
}

function countsAgentMemory(abs: string, name: string): boolean {
  if (!statIfPresent(join(abs, name))?.isDirectory()) return false
  return readRegularFile(join(abs, name, 'MEMORY.md')) !== undefined
}

function countsScript(_abs: string, name: string): boolean {
  return SCRIPT_SUFFIXES.some((s) => name.endsWith(s))
}

function countsPluginBundle(abs: string, name: string): boolean {
  if (!statIfPresent(join(abs, name))?.isDirectory()) return false
  const skills = join(abs, name, 'skills')
  if (!statIfPresent(skills)?.isDirectory()) return false
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- same convention
  readdirSync(skills)
  return true
}

const COUNTERS: Record<Exclude<Kind, 'command-md'>, (abs: string, name: string) => boolean> = {
  'agent-md': countsAgentMd,
  'agent-memory': countsAgentMemory,
  scripts: countsScript,
  'plugin-bundles': countsPluginBundle,
}

/** Walk a directory the way `readCommandsDir` does: nested folders, `.md` files, closed frontmatter. */
function countCommands(abs: string, rel: string, out: Count): void {
  let entries: string[]
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- same convention
    entries = readdirSync(abs).sort((a, b) => a.localeCompare(b))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') out.unreadable.push(rel)
    return
  }
  for (const name of entries) {
    const path = join(abs, name)
    const entryRel = `${rel}/${name}`
    try {
      const stats = statIfPresent(path)
      if (stats === undefined) continue
      if (stats.isDirectory()) {
        countCommands(path, entryRel, out)
      } else if (
        stats.isFile() &&
        name.endsWith('.md') &&
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- same convention
        splitFrontmatter(readFileSync(path, 'utf8')) !== undefined
      ) {
        out.count++
      }
    } catch {
      out.unreadable.push(entryRel)
    }
  }
}

function count(root: string, { dir, kind }: Folder): Count {
  const out: Count = { count: 0, unreadable: [], names: [] }
  if (kind === 'command-md') {
    countCommands(join(root, dir), dir, out)
    return out
  }
  const abs = join(root, dir)
  let entries: string[]
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- same convention
    entries = readdirSync(abs).sort((a, b) => a.localeCompare(b))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') out.unreadable.push(dir)
    return out
  }
  for (const name of entries) {
    try {
      if (!COUNTERS[kind](abs, name)) continue
      out.count++
      if (kind === 'scripts') out.names.push(name)
    } catch {
      out.unreadable.push(`${dir}/${name}`)
    }
  }
  return out
}

/**
 * Count each folder under the foreign root and say whether the framework reads or refuses it.
 * `state` comes from the gate's own surface list: a mapped surface absent from `enabled` is refused.
 */
export function foreignSurfaceInventory(input: {
  readonly cwd: string
  readonly root?: string
  readonly enabled?: readonly CompatSurface[]
  /** Only scan these folders (e.g. `['workflows']`), so a caller needing one is not slowed by others. */
  readonly dirs?: readonly string[]
}): readonly ForeignSurfaceEntry[] {
  const root = join(input.cwd, input.root ?? '.claude')
  const gate = new Set<CompatSurface>(EVERY_SURFACE)
  const enabled = new Set<CompatSurface>(
    (input.enabled ?? EVERY_SURFACE).filter((surface) => gate.has(surface)),
  )
  const rows: { folder: Folder; surface: CompatSurface | null }[] = [
    ...(Object.keys(SURFACE_FOLDERS) as CompatSurface[]).flatMap((surface) =>
      SURFACE_FOLDERS[surface].map((folder) => ({ folder, surface })),
    ),
    ...REFUSED_FOLDERS.map((folder) => ({ folder, surface: null })),
  ]
  const wanted = input.dirs === undefined ? undefined : new Set(input.dirs)
  return rows
    .filter(({ folder }) => wanted === undefined || wanted.has(folder.dir))
    .map(({ folder, surface }) => {
      const c = count(root, folder)
      const read = surface !== null && enabled.has(surface)
      const reason =
        surface === null ? WORKFLOWS_REFUSAL_REASON : `the '${surface}' surface is not enabled`
      return {
        dir: folder.dir,
        state: read ? 'read' : 'refused',
        count: c.count,
        unreadable: c.unreadable,
        ...(read ? {} : { reason }),
        ...(folder.kind === 'scripts' ? { names: c.names } : {}),
      } satisfies ForeignSurfaceEntry
    })
}
