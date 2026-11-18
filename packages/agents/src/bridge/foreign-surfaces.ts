import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

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

type Kind = 'frontmatter-md' | 'agent-memory' | 'scripts' | 'plugin-bundles'

/** Folder → the gate surface that governs it (`null`: no gate surface ever loads it). */
const FOLDERS: readonly { dir: string; surface: CompatSurface | null; kind: Kind }[] = [
  { dir: 'agents', surface: 'subagents', kind: 'frontmatter-md' },
  { dir: 'commands', surface: 'commands', kind: 'frontmatter-md' },
  { dir: 'agent-memory', surface: 'subagents', kind: 'agent-memory' },
  { dir: 'workflows', surface: null, kind: 'scripts' },
  { dir: 'plugins', surface: 'plugins', kind: 'plugin-bundles' },
]

const SCRIPT_SUFFIXES = ['.js', '.mjs', '.cjs'] as const

interface Count {
  count: number
  unreadable: string[]
  names: string[]
}

function isDir(p: string): boolean {
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- caller's project root plus fixed convention
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

/** Each counter returns whether the entry counts; it may throw when the entry cannot be read. */
function countsFrontmatterMd(abs: string, name: string): boolean {
  const p = join(abs, name)
  if (!name.endsWith('.md') || isDir(p)) return false
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- same convention
  return readFileSync(p, 'utf8').replace(/^\uFEFF/, '').startsWith('---')
}

function countsAgentMemory(abs: string, name: string): boolean {
  const p = join(abs, name)
  if (!isDir(p)) return false
  const file = join(p, 'MEMORY.md')
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- same convention
  if (!existsSync(file)) return false
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- same convention
  readFileSync(file, 'utf8')
  return true
}

function countsScript(_abs: string, name: string): boolean {
  return SCRIPT_SUFFIXES.some((s) => name.endsWith(s))
}

function countsPluginBundle(abs: string, name: string): boolean {
  const skills = join(abs, name, 'skills')
  if (!isDir(skills)) return false
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- same convention
  readdirSync(skills)
  return true
}

const COUNTERS: Record<Kind, (abs: string, name: string) => boolean> = {
  'frontmatter-md': countsFrontmatterMd,
  'agent-memory': countsAgentMemory,
  scripts: countsScript,
  'plugin-bundles': countsPluginBundle,
}

function count(root: string, dir: string, kind: Kind): Count {
  const out: Count = { count: 0, unreadable: [], names: [] }
  const abs = join(root, dir)
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- same convention
  if (!existsSync(abs)) return out
  let entries: string[]
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- same convention
    entries = readdirSync(abs).sort((a, b) => a.localeCompare(b))
  } catch {
    out.unreadable.push(dir)
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
}): readonly ForeignSurfaceEntry[] {
  const root = join(input.cwd, input.root ?? '.claude')
  const enabled = new Set<CompatSurface>(input.enabled ?? EVERY_SURFACE)
  return FOLDERS.map(({ dir, surface, kind }) => {
    const c = count(root, dir, kind)
    const read = surface !== null && enabled.has(surface)
    const reason =
      surface === null
        ? WORKFLOWS_REFUSAL_REASON
        : `the '${surface}' surface is not enabled`
    return {
      dir,
      state: read ? 'read' : 'refused',
      count: c.count,
      unreadable: c.unreadable,
      ...(read ? {} : { reason }),
      ...(kind === 'scripts' ? { names: c.names } : {}),
    } satisfies ForeignSurfaceEntry
  })
}
