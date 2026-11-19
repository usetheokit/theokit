/**
 * What a foreign configuration root (`.claude/` by default) holds, and what this framework does
 * with each folder: read it, or refuse it.
 *
 * ## One declaration, no second table
 *
 * The `state` of an entry is derived from the gate's own enumeration ({@link EVERY_SURFACE}) and the
 * caller's `enabled` list: a folder is `read` when the compat surface that feeds it is enabled. The
 * only literal refusal is `workflows`, which no surface admits (see `unloaded-surfaces.ts`).
 *
 * ## Counted the way the loaders count
 *
 * `count` is what the folder's own loader would take, so an inventory never reports a definition the
 * loader would drop. An entry that exists and cannot be read is listed in `unreadable` instead of
 * throwing: an inventory is a report, and a report that dies on one bad file reports nothing.
 */
import { readdirSync, readFileSync, statSync, type Dirent } from 'node:fs'
import { join } from 'node:path'

import { splitFrontmatter } from '../config/frontmatter.js'

import {
  EVERY_SURFACE,
  REFUSED_FOLDERS,
  SURFACE_FOLDERS,
  type CompatSurface,
} from './setting-sources-gate.js'

export interface ForeignSurfaceEntry {
  /** Folder name relative to the foreign root, e.g. `'agents'`. */
  readonly dir: string
  readonly state: 'read' | 'refused'
  /** What the surface's own loader would take. */
  readonly count: number
  /** Entries that exist and could not be read, relative to the foreign root. */
  readonly unreadable: readonly string[]
  /** For `'refused'`, why. */
  readonly reason?: string
}

export interface ForeignSurfaceInventoryInput {
  readonly cwd: string
  /** Foreign root, relative to `cwd`. Default `'.claude'`. */
  readonly root?: string
  /** Surfaces the caller enabled. Default: every surface. */
  readonly enabled?: readonly CompatSurface[]
}

/** Why `workflows` is refused. `reportUnloadedSurfaces` appends this to its warning verbatim. */
export const WORKFLOW_REFUSAL_REASON =
  `Every configuration surface it loads is data (commands, hooks, plugins, skills, ` +
  `subagents); a workflow file is code, and executing JavaScript found under a caller-supplied ` +
  `directory is a trust decision that belongs to you rather than to this library. The ` +
  `orchestration itself is supported: build the same pipeline with Workflow / agentStep / ` +
  `createSquad from @theokit/sdk, which you import explicitly.`

/** What a workflow script is named. `.mjs` and `.cjs` count — the refusal is about execution. */
const SCRIPT_SUFFIXES = ['.js', '.mjs', '.cjs'] as const

interface Scan {
  readonly unreadable: string[]
  /** Names the counter took, for callers that need them. */
  readonly names: string[]
}

/** How each folder is counted. A folder the gate declares without a counter is not inventoried. */
const SCANNERS: Readonly<Record<string, ((path: string, dir: string) => Scan) | undefined>> = {
  agents: scanAgents,
  commands: scanCommands,
  skills: scanSkills,
  'agent-memory': scanAgentMemory,
  workflows: scanWorkflows,
  plugins: scanPlugins,
}

/** Every folder the gate declares, with the surface that admits it (`undefined`: none does). */
function declaredFolders(): readonly { dir: string; surface: CompatSurface | undefined }[] {
  return [
    ...EVERY_SURFACE.flatMap((surface) =>
      SURFACE_FOLDERS[surface].map((dir) => ({ dir, surface }) as const),
    ),
    ...REFUSED_FOLDERS.map((dir) => ({ dir, surface: undefined })),
  ]
}

export function foreignSurfaceInventory(
  input: ForeignSurfaceInventoryInput,
): readonly ForeignSurfaceEntry[] {
  return scanForeignSurfaces(input).map(({ entry }) => entry)
}

/** The inventory with the names each counter took; shared with `reportUnloadedSurfaces`. */
function scanForeignSurfaces(
  input: ForeignSurfaceInventoryInput,
): readonly { readonly entry: ForeignSurfaceEntry; readonly names: readonly string[] }[] {
  const root = join(input.cwd, input.root ?? '.claude')
  // Only surfaces the gate knows can be read, whatever the caller passes.
  const known = new Set<CompatSurface>(EVERY_SURFACE)
  const enabled = new Set((input.enabled ?? EVERY_SURFACE).filter((surface) => known.has(surface)))
  return declaredFolders().flatMap(({ dir, surface }) => {
    const scan = SCANNERS[dir]
    if (scan === undefined) return []
    const { unreadable, names } = scan(join(root, dir), dir)
    const count = names.length
    const read = surface !== undefined && enabled.has(surface)
    const reason = refusalReason(surface, read)
    const entry: ForeignSurfaceEntry = {
      dir,
      state: read ? 'read' : 'refused',
      count,
      unreadable,
      ...(reason !== undefined && { reason }),
    }
    return [{ entry, names }]
  })
}

function refusalReason(surface: CompatSurface | undefined, read: boolean): string | undefined {
  if (surface === undefined) return WORKFLOW_REFUSAL_REASON
  return read ? undefined : `the '${surface}' surface is not enabled`
}

function listDir(path: string, label: string, scan: Scan): Dirent[] {
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- the caller's own project root joined with a fixed convention
    return readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') scan.unreadable.push(label)
    return []
  }
}

/** Reads a regular file. Anything else (a FIFO, a directory) is refused before it can block a read. */
function readText(path: string): string {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- same path convention
  if (!statSync(path).isFile()) {
    throw Object.assign(new Error(`not a regular file: ${path}`), { code: 'EISDIR' })
  }
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- same path convention
  return readFileSync(path, 'utf8')
}

function emptyScan(): Scan {
  return { unreadable: [], names: [] }
}

function take(scan: Scan, name: string): void {
  scan.names.push(name)
}

function scanAgents(path: string, dir: string): Scan {
  const scan = emptyScan()
  for (const entry of listDir(path, dir, scan)) {
    // The SDK's `readSubagentsFrom` filter: regular `.md` files that open with frontmatter.
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    try {
      if (opensWithFence(readText(join(path, entry.name)))) take(scan, entry.name)
    } catch {
      scan.unreadable.push(`${dir}/${entry.name}`)
    }
  }
  return scan
}

function scanCommands(path: string, dir: string): Scan {
  // `readCommandsDir` in `config/custom-commands.ts`: stat-based, so symlinks are followed; every
  // `.md` is walked, nested folders included, and a file whose frontmatter never closes is skipped.
  const scan = emptyScan()
  const walk = (current: string, label: string): void => {
    for (const entry of listDir(current, label, scan)) {
      const full = join(current, entry.name)
      let stats
      try {
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- same path convention
        stats = statSync(full)
      } catch {
        continue // vanished, or a dangling link: the loader skips it as well
      }
      if (stats.isDirectory()) walk(full, `${label}/${entry.name}`)
      else if (stats.isFile() && entry.name.endsWith('.md')) {
        try {
          if (splitFrontmatter(readText(full)) !== undefined) take(scan, entry.name)
        } catch {
          scan.unreadable.push(`${label}/${entry.name}`)
        }
      }
    }
  }
  walk(path, dir)
  return scan
}

function scanSkills(path: string, dir: string): Scan {
  const scan = emptyScan()
  for (const entry of listDir(path, dir, scan)) {
    if (!entry.isDirectory()) continue
    let raw: string
    try {
      raw = readText(join(path, entry.name, 'SKILL.md'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        scan.unreadable.push(`${dir}/${entry.name}/SKILL.md`)
      }
      continue
    }
    if (isValidSkill(raw)) take(scan, entry.name)
  }
  return scan
}

function scanAgentMemory(path: string, dir: string): Scan {
  const scan = emptyScan()
  for (const entry of listDir(path, dir, scan)) {
    if (!entry.isDirectory()) continue
    try {
      readText(join(path, entry.name, 'MEMORY.md'))
      take(scan, entry.name)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        scan.unreadable.push(`${dir}/${entry.name}/MEMORY.md`)
      }
    }
  }
  return scan
}

function scanWorkflows(path: string, dir: string): Scan {
  const scan = emptyScan()
  for (const entry of listDir(path, dir, scan)) {
    if (SCRIPT_SUFFIXES.some((s) => entry.name.endsWith(s))) take(scan, entry.name)
  }
  return scan
}

function scanPlugins(path: string, dir: string): Scan {
  const scan = emptyScan()
  for (const entry of listDir(path, dir, scan)) {
    if (!entry.isDirectory()) continue
    // A bundle counts when it ships a `skills/` folder; a bundle that cannot be listed is reported.
    const bundle = join(path, entry.name)
    const inside = listDir(bundle, `${dir}/${entry.name}`, scan)
    if (inside.some((e) => e.isDirectory() && e.name === 'skills')) take(scan, entry.name)
  }
  return scan
}

/**
 * Where the text after an opening or closing fence begins, if the fence line ends: the SDK's
 * `---\s*\n`. The whitespace run after the fence must contain a newline; the match ends after the
 * last one. Written out rather than as a regex so a long run of blanks cannot backtrack.
 */
function afterFenceLine(raw: string, from: number): number | undefined {
  let end = from
  while (end < raw.length && /\s/.test(raw.charAt(end))) end += 1
  const newline = raw.lastIndexOf('\n', end - 1)
  return newline >= from ? newline + 1 : undefined
}

/** The SDK's `hasFrontmatter`: the file begins exactly with `---`, and the fence line ends. */
function opensWithFence(raw: string): boolean {
  return raw.startsWith('---') && afterFenceLine(raw, 3) !== undefined
}

/** The SDK's skill pattern `^---\s*\n([\s\S]*?)\n---\s*\n`: the text between the fences. */
function frontmatterOf(raw: string): string | undefined {
  const start = raw.startsWith('---') ? afterFenceLine(raw, 3) : undefined
  if (start === undefined) return undefined
  for (let at = raw.indexOf('\n---', start); at !== -1; at = raw.indexOf('\n---', at + 1)) {
    if (afterFenceLine(raw, at + 4) !== undefined) return raw.slice(start, at)
  }
  return undefined
}

/**
 * The SDK's `discoverSkills` acceptance rule, synchronously: frontmatter present, a non-empty string
 * `description`, and the two authorization flags literal booleans when present.
 */
function isValidSkill(raw: string): boolean {
  const text = frontmatterOf(raw)
  if (text === undefined) return false
  const fields = parseFields(text)
  const description = fields.get('description')
  if (typeof description !== 'string' || description.trim().length === 0) return false
  return ['disable-model-invocation', 'user-invocable'].every((flag) => {
    const value = fields.get(flag)
    return value === undefined || typeof value === 'boolean'
  })
}

/** Lines of a block list that starts after `start`, and the index it ends at (exclusive). */
function blockListEnd(lines: readonly string[], start: number): { items: number; end: number } {
  let items = 0
  let end = start
  for (; end < lines.length; end += 1) {
    const next = (lines[end] ?? '').trim()
    if (next === '' || next.startsWith('#')) continue
    if (!next.startsWith('- ')) break
    items += 1
  }
  return { items, end }
}

function coerce(raw: string): unknown {
  if (raw.length === 0) return undefined
  if (raw.startsWith('[') && raw.endsWith(']')) return []
  if (raw === 'true' || raw === 'false') return raw === 'true'
  const n = Number(raw)
  return Number.isFinite(n) && raw === String(n) ? n : raw
}

/** The SDK's simple frontmatter reading: `key: value` lines, block lists, last key wins. */
function parseFields(text: string): Map<string, unknown> {
  const fields = new Map<string, unknown>()
  const lines = text.split(/\r?\n/)
  let i = 0
  while (i < lines.length) {
    const line = lines[i] ?? ''
    i += 1
    const colon = line.indexOf(':')
    const key = colon === -1 ? '' : line.slice(0, colon).trim()
    if (key.length === 0) continue
    const raw = line.slice(colon + 1).trim()
    const block = raw.length === 0 ? blockListEnd(lines, i) : undefined
    if (block !== undefined && block.items > 0) {
      fields.set(key, [])
      i = block.end
    } else {
      fields.set(key, coerce(raw))
    }
  }
  return fields
}

/** The workflow scripts under `<cwd>/<root>/workflows`, sorted; a folder that cannot be listed has none. */
export function workflowScripts(cwd: string, root = '.claude'): readonly string[] {
  return [...scanWorkflows(join(cwd, root, 'workflows'), 'workflows').names].sort((a, b) =>
    a.localeCompare(b),
  )
}
