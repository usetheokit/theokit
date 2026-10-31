import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { parse as parseYaml } from 'yaml'

import { type NormalisedMcp, normaliseMcpEntry } from './mcp-entry.js'

/**
 * What a reader returns (FR-001, FR-002): the instructions, MCP entries, skills and memories of one
 * source, normalised, plus every entry it found and did not carry, named by its path relative to
 * the source and a reason (FR-003). Nothing here carries a value of an MCP `env` or `headers`
 * entry into a reason or a path (NFR-003).
 */
export interface ForeignSetup {
  readonly kind: 'claude-code' | 'hermes'
  readonly source: string
  readonly instructions: TextFile[]
  readonly mcpServers: Record<string, NormalisedMcp>
  readonly skills: ForeignSkill[]
  readonly memories: TextFile[]
  readonly dropped: DroppedEntry[]
}

export interface TextFile {
  readonly path: string
  readonly text: string
}

export interface ForeignSkill {
  readonly name: string
  readonly description: string
  readonly body: string
  /** Relative to the source. */
  readonly path: string
}

export interface DroppedEntry {
  /** Relative to the source. */
  readonly path: string
  readonly reason: string
}

/** Every file a reader opens is capped at this many bytes (FR-003, D4). */
export const FILE_CAP = 262_144

/** A skill name staged as a directory name: no separator, no dot-led name (EC-1). */
export const SAFE_SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

/**
 * The text of `path`, or `undefined` when it does not exist or is over {@link FILE_CAP}, in which
 * case `rel` is listed as dropped. A path that is not a regular file (a directory named `CLAUDE.md`)
 * reads as absent: FR-003 lists no reason for it, and no reader names such a path as an entry.
 */
export function readCapped(path: string, rel: string, dropped: DroppedEntry[]): string | undefined {
  let size: number
  try {
    const stat = statSync(path)
    if (!stat.isFile()) return undefined
    size = stat.size
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  if (size > FILE_CAP) {
    dropped.push({ path: rel, reason: `file over ${FILE_CAP} bytes` })
    return undefined
  }
  return readFileSync(path, 'utf8')
}

/** The names in `dir`; none when it does not exist. */
function listDir(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

/** Whether `path` is a regular file, a symlink followed; `false` when it does not exist. */
function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/**
 * The entries of `dir` that are directories, a symlink to one included (a skill linked into
 * `~/.claude/skills` is a skill), by name; none when `dir` does not exist.
 */
function subdirectories(dir: string): string[] {
  return listDir(dir).filter((name) => isDirectory(join(dir, name))).sort()
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch (error) {
    // A dangling link is not a directory.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/** A whole `---` line opens and closes the frontmatter, as the runtime's own reader requires. */
const FRONTMATTER = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/

type ParsedSkill = { readonly skill: Omit<ForeignSkill, 'path'> } | { readonly reason: string }

/** The skill `text` declares, or why it is not carried. `taken` holds the names already read. */
function parseSkill(text: string, taken: ReadonlySet<string>): ParsedSkill {
  const lacks = { reason: 'frontmatter lacks name or description' }
  const match = FRONTMATTER.exec(text)
  if (match === null) return lacks
  let data: unknown
  try {
    data = parseYaml(match[1])
  } catch {
    // Unparsable YAML declares no name: FR-003 has one reason for both.
    return lacks
  }
  const { name, description } = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>
  if (typeof name !== 'string' || typeof description !== 'string') return lacks
  if (!SAFE_SKILL_NAME.test(name)) return { reason: 'skill name is not a safe directory name' }
  if (taken.has(name)) return { reason: 'duplicated name' }
  return { skill: { name, description, body: text.slice(match[0].length) } }
}

/**
 * Every `<name>/SKILL.md` under `dir`, in directory-name order, the first of a duplicated name
 * winning. `relBase` is `dir` relative to the source, for the dropped paths.
 */
export function readSkillsDir(dir: string, relBase: string, dropped: DroppedEntry[]): ForeignSkill[] {
  const skills: ForeignSkill[] = []
  const taken = new Set<string>()
  for (const directory of subdirectories(dir)) {
    const rel = `${relBase}/${directory}/SKILL.md`
    const path = join(dir, directory, 'SKILL.md')
    if (!isFile(path)) {
      dropped.push({ path: `${relBase}/${directory}`, reason: 'no SKILL.md' })
      continue
    }
    const text = readCapped(path, rel, dropped)
    if (text === undefined) continue
    const parsed = parseSkill(text, taken)
    if ('reason' in parsed) {
      dropped.push({ path: rel, reason: parsed.reason })
      continue
    }
    taken.add(parsed.skill.name)
    skills.push({ ...parsed.skill, path: rel })
  }
  return skills
}

/** Each of `files` (`[path, rel]`) that exists and is under the cap, in the order given. */
export function readTextFiles(files: ReadonlyArray<readonly [string, string]>, dropped: DroppedEntry[]): TextFile[] {
  const read: TextFile[] = []
  for (const [path, rel] of files) {
    const text = readCapped(path, rel, dropped)
    if (text !== undefined) read.push({ path: rel, text })
  }
  return read
}

/** The `*.md` regular files directly under `dir`, `first` (when present) ahead of the rest by name. */
export function markdownFiles(dir: string, first: string): string[] {
  const files = listDir(dir).filter((name) => name.endsWith('.md') && isFile(join(dir, name))).sort()
  return files.includes(first) ? [first, ...files.filter((name) => name !== first)] : files
}

/**
 * The carried entries of one source's MCP map, `file` naming it in the dropped paths: an entry
 * that is not carried as `<file>#<server>`, a key that is not as `<file>#<server>.<key>`.
 */
export function normaliseMcpMap(map: Record<string, unknown>, file: string, dropped: DroppedEntry[]): Record<string, NormalisedMcp> {
  const carried: Record<string, NormalisedMcp> = {}
  for (const [name, raw] of Object.entries(map)) {
    const normalised = normaliseMcpEntry(raw)
    if (normalised.reason !== undefined) {
      dropped.push({ path: `${file}#${name}`, reason: normalised.reason })
      continue
    }
    for (const key of normalised.notCarried) dropped.push({ path: `${file}#${name}.${key}`, reason: 'field not carried' })
    carried[name] = normalised.entry
  }
  return carried
}

/** `user` without the names `project` carries, each shadowed one listed as dropped by `pathOf`. */
export function shadow<T>(
  user: Record<string, T>,
  project: Record<string, T>,
  pathOf: (name: string, value: T) => string,
  dropped: DroppedEntry[],
): Record<string, T> {
  const kept: Record<string, T> = {}
  for (const [name, value] of Object.entries(user)) {
    if (Object.hasOwn(project, name)) dropped.push({ path: pathOf(name, value), reason: 'shadowed by the project scope' })
    else kept[name] = value
  }
  return { ...kept, ...project }
}
