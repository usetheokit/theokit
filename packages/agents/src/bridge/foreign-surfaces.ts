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
    const rel = `${dir}/${name}`
    const p = join(abs, name)
    try {
      if (kind === 'frontmatter-md') {
        if (!name.endsWith('.md') || isDir(p)) continue
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- same convention
        if (readFileSync(p, 'utf8').replace(/^﻿/, '').startsWith('---')) out.count++
      } else if (kind === 'agent-memory') {
        if (!isDir(p)) continue
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- same convention
        if (existsSync(join(p, 'MEMORY.md'))) {
          // eslint-disable-next-line security/detect-non-literal-fs-filename -- same convention
          readFileSync(join(p, 'MEMORY.md'), 'utf8')
          out.count++
        }
      } else if (kind === 'scripts') {
        if (SCRIPT_SUFFIXES.some((s) => name.endsWith(s))) {
          out.count++
          out.names.push(name)
        }
      } else if (isDir(join(p, 'skills'))) {
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- same convention
        readdirSync(join(p, 'skills'))
        out.count++
      }
    } catch {
      out.unreadable.push(rel)
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
