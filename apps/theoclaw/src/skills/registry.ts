import { accessSync, constants, existsSync, readdirSync, readFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'

import { type InlineSkill, Skill } from '@theokit/sdk'

/**
 * OC-70..72, OC-74 (B-389): the SKILL.md format, the precedence between skill sources, the gate on
 * required binaries, and the registry that offers the result. A workspace skill beats a bundled one
 * of the same name; a skill whose required binary is not on PATH is not offered.
 */
export type SkillSource = 'bundled' | 'workspace'

export interface SkillEntry {
  readonly name: string
  readonly description: string
  readonly instructions: string
  readonly source: SkillSource
  /** Binaries that must be on PATH before the skill is offered. */
  readonly requiresBins: readonly string[]
}

/** Later sources win: workspace over bundled. */
const PRECEDENCE: readonly SkillSource[] = ['bundled', 'workspace']

/** Parses `---` frontmatter (`name`, `description`, `requires: bin, bin`) and the body. Undefined when malformed. */
export function parseSkillMarkdown(text: string, source: SkillSource): SkillEntry | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  if (match === null) return undefined
  const fields = new Map<string, string>()
  for (const line of (match[1] ?? '').split(/\r?\n/)) {
    const colon = line.indexOf(':')
    if (colon > 0) fields.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim())
  }
  const name = fields.get('name')
  const description = fields.get('description')
  if (name === undefined || name === '' || description === undefined || description === '') return undefined
  const requiresBins = (fields.get('requires') ?? '').split(',').map((bin) => bin.trim()).filter((bin) => bin !== '')
  return { name, description, instructions: (match[2] ?? '').trim(), source, requiresBins }
}

/** Reads `<dir>/<skill>/SKILL.md` for each skill directory; unreadable or malformed ones are skipped. */
export function loadSkillDirectory(dir: string, source: SkillSource): SkillEntry[] {
  if (!existsSync(dir)) return []
  const entries: SkillEntry[] = []
  for (const child of readdirSync(dir, { withFileTypes: true })) {
    if (!child.isDirectory()) continue
    try {
      const parsed = parseSkillMarkdown(readFileSync(join(dir, child.name, 'SKILL.md'), 'utf8'), source)
      if (parsed !== undefined) entries.push(parsed)
    } catch {
      // No SKILL.md in this directory.
    }
  }
  return entries
}

export const BUNDLED_SKILLS: readonly SkillEntry[] = [
  {
    name: 'git-helper',
    description: 'Inspect repository state and history with git before changing anything.',
    instructions: 'Run `git status` and `git log --oneline -10` first; never rewrite history without being asked.',
    source: 'bundled',
    requiresBins: ['git'],
  },
  {
    name: 'summarize-text',
    description: 'Summarize a long text into a short list of points.',
    instructions: 'Read the whole text, then answer with at most five bullet points that keep names and numbers.',
    source: 'bundled',
    requiresBins: [],
  },
]

/** True when `bin` is an executable file in one of the PATH directories. */
export function binaryOnPath(bin: string, pathValue: string = process.env.PATH ?? ''): boolean {
  const extensions = process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : ['']
  for (const directory of pathValue.split(delimiter)) {
    if (directory === '') continue
    for (const extension of extensions) {
      try {
        accessSync(join(directory, bin + extension), constants.X_OK)
        return true
      } catch {
        // Not here.
      }
    }
  }
  return false
}

export interface SkillRegistryOptions {
  readonly workspaceDir?: string
  readonly bundled?: readonly SkillEntry[]
  /** PATH to gate against; defaults to the process PATH. */
  readonly path?: string
}

export class SkillRegistry {
  private readonly merged = new Map<string, SkillEntry>()

  constructor(private readonly options: SkillRegistryOptions = {}) {
    const workspace = options.workspaceDir === undefined ? [] : loadSkillDirectory(options.workspaceDir, 'workspace')
    const all = [...(options.bundled ?? BUNDLED_SKILLS), ...workspace]
    for (const source of PRECEDENCE) for (const entry of all) if (entry.source === source) this.merged.set(entry.name, entry)
  }

  /** The skill that wins for `name`, offered or not. */
  resolve(name: string): SkillEntry | undefined {
    return this.merged.get(name)
  }

  /** Binaries a skill needs that are not on PATH. */
  missingBins(entry: SkillEntry): string[] {
    return entry.requiresBins.filter((bin) => !binaryOnPath(bin, this.options.path))
  }

  /** The skills a session may be offered: winners whose required binaries are all present. */
  offered(): SkillEntry[] {
    return [...this.merged.values()].filter((entry) => this.missingBins(entry).length === 0)
  }

  /** The offered skills as SDK inline skills. */
  inlineSkills(): InlineSkill[] {
    return this.offered().map((entry) => Skill.create({ name: entry.name, description: entry.description, instructions: entry.instructions }))
  }
}
