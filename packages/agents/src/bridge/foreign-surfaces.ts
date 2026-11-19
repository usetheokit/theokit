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
import { readdirSync, readFileSync, type Dirent } from 'node:fs'
import { join } from 'node:path'

import { EVERY_SURFACE, type CompatSurface } from './setting-sources-gate.js'

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

/** The folders, and the gate surface that feeds each (`undefined`: no surface admits it). */
const FOLDERS: readonly {
  readonly dir: string
  readonly surface: CompatSurface | undefined
  readonly scan: (path: string, dir: string) => Scan
}[] = [
  { dir: 'agents', surface: 'subagents', scan: scanAgents },
  { dir: 'commands', surface: 'commands', scan: scanCommands },
  { dir: 'skills', surface: 'skills', scan: scanSkills },
  // Memory is applied by the host, not loaded by the gate; it follows the surface that carries agents.
  { dir: 'agent-memory', surface: 'subagents', scan: scanAgentMemory },
  { dir: 'workflows', surface: undefined, scan: scanWorkflows },
  { dir: 'plugins', surface: 'plugins', scan: scanPlugins },
]

export function foreignSurfaceInventory(
  input: ForeignSurfaceInventoryInput,
): readonly ForeignSurfaceEntry[] {
  return scanForeignSurfaces(input).map(({ entry }) => entry)
}

/** The inventory with the names each counter took; shared with `reportUnloadedSurfaces`. */
export function scanForeignSurfaces(
  input: ForeignSurfaceInventoryInput,
): readonly { readonly entry: ForeignSurfaceEntry; readonly names: readonly string[] }[] {
  const root = join(input.cwd, input.root ?? '.claude')
  const enabled = input.enabled ?? EVERY_SURFACE
  return FOLDERS.map(({ dir, surface, scan }) => {
    const { unreadable, names } = scan(join(root, dir), dir)
    const count = names.length
    const read = surface !== undefined && enabled.includes(surface)
    const reason = refusalReason(surface, read)
    const entry: ForeignSurfaceEntry = {
      dir,
      state: read ? 'read' : 'refused',
      count,
      unreadable,
      ...(reason !== undefined && { reason }),
    }
    return { entry, names }
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

function readText(path: string): string {
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
  // `readCommandsDir` in `config/custom-commands.ts`: every `.md`, nested folders included.
  const scan = emptyScan()
  const walk = (current: string, label: string): void => {
    for (const entry of listDir(current, label, scan)) {
      if (entry.isDirectory()) walk(join(current, entry.name), `${label}/${entry.name}`)
      else if (entry.isFile() && entry.name.endsWith('.md')) {
        try {
          readText(join(current, entry.name))
          take(scan, entry.name)
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

function opensWithFence(raw: string): boolean {
  return raw.slice(0, raw.indexOf('\n')).trim() === '---'
}

/** The text between the fences, when the file opens with one and closes it on a line of its own. */
function frontmatterOf(raw: string): string | undefined {
  if (!opensWithFence(raw)) return undefined
  const lines = raw.split('\n')
  const closing = lines.findIndex((line, index) => index > 0 && line.trimEnd() === '---')
  // The SDK's pattern needs a newline after the closing fence.
  if (closing === -1 || closing === lines.length - 1) return undefined
  return lines.slice(1, closing).join('\n')
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
