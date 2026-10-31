import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'

import {
  type DroppedEntry,
  type ForeignSetup,
  type ForeignSkill,
  markdownFiles,
  normaliseMcpMap,
  readCapped,
  readSkillsDir,
  readTextFiles,
  shadow,
} from './foreign-setup.js'
import { isPlainObject, type NormalisedMcp } from './mcp-entry.js'

export interface ClaudeCodeInput {
  /** Claude Code's config directory. Default `<home>/.claude`. */
  readonly configDir?: string
  readonly home: string
  /** The project whose scope and auto memory are read; none read without it. */
  readonly project?: string
}

/**
 * A Claude Code setup (FR-001): the user scope under `configDir` and `<home>/.claude.json`, and,
 * with a project, its `CLAUDE.md` files, `.mcp.json`, `.claude/skills` and the auto memory Claude
 * Code keys by the project's git root. A project entry carried under a shared name shadows the
 * user's; one the project could not carry shadows nothing. Dropped paths are relative to
 * `configDir`, except `.claude.json` (the home's) and `project/…` (the project's).
 */
export function readClaudeCodeSetup(input: ClaudeCodeInput): ForeignSetup {
  const configDir = input.configDir ?? join(input.home, '.claude')
  // Resolved before git and the encoding, so `--project .` keys the same memory (EC-3).
  const project = input.project === undefined ? undefined : resolve(input.project)
  const dropped: DroppedEntry[] = []
  const instructions = readTextFiles(instructionFiles(configDir, project), dropped)
  const mcpServers = readMcpServers(input.home, project, dropped)
  const skills = readSkills(configDir, project, dropped)
  const memories = project === undefined ? [] : readMemories(configDir, project, dropped)
  return { kind: 'claude-code', source: configDir, instructions, mcpServers, skills, memories, dropped }
}

/** `CLAUDE.md` of the config directory, then the project's two, each as `[path, rel]`. */
function instructionFiles(configDir: string, project: string | undefined): Array<readonly [string, string]> {
  const files: Array<readonly [string, string]> = [[join(configDir, 'CLAUDE.md'), 'CLAUDE.md']]
  if (project !== undefined) {
    files.push([join(project, 'CLAUDE.md'), 'project/CLAUDE.md'], [join(project, '.claude', 'CLAUDE.md'), 'project/.claude/CLAUDE.md'])
  }
  return files
}

function readMcpServers(home: string, project: string | undefined, dropped: DroppedEntry[]): Record<string, NormalisedMcp> {
  const user = normaliseMcpMap(readMcpConfig(join(home, '.claude.json'), '.claude.json', dropped), '.claude.json', dropped)
  if (project === undefined) return user
  const projectRel = 'project/.mcp.json'
  const projectServers = normaliseMcpMap(readMcpConfig(join(project, '.mcp.json'), projectRel, dropped), projectRel, dropped)
  return shadow(user, projectServers, (name) => `.claude.json#${name}`, dropped)
}

/** The `mcpServers` map of a JSON config file, capped like every file (D4); `{}` when there is none. */
function readMcpConfig(path: string, rel: string, dropped: DroppedEntry[]): Record<string, unknown> {
  const text = readCapped(path, rel, dropped)
  if (text === undefined) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    // One broken file loses its own servers, not the rest of the setup.
    dropped.push({ path: rel, reason: 'not valid JSON' })
    return {}
  }
  if (!isPlainObject(parsed)) {
    dropped.push({ path: rel, reason: 'not a JSON object' })
    return {}
  }
  const servers = parsed.mcpServers
  if (servers === undefined) return {}
  if (!isPlainObject(servers)) {
    dropped.push({ path: rel, reason: 'mcpServers is not an object' })
    return {}
  }
  return servers
}

function readSkills(configDir: string, project: string | undefined, dropped: DroppedEntry[]): ForeignSkill[] {
  const byName = (skills: ForeignSkill[]): Record<string, ForeignSkill> => Object.fromEntries(skills.map((skill) => [skill.name, skill]))
  const user = byName(readSkillsDir(join(configDir, 'skills'), 'skills', dropped))
  const projectSkills =
    project === undefined ? {} : byName(readSkillsDir(join(project, '.claude', 'skills'), 'project/.claude/skills', dropped))
  const merged = shadow(user, projectSkills, (_name, skill) => skill.path, dropped)
  return Object.values(merged).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

/** The auto memory: `*.md` directly under `projects/<encoded root>/memory`, `MEMORY.md` first. */
function readMemories(configDir: string, project: string, dropped: DroppedEntry[]): ForeignSetup['memories'] {
  const encoded = encodeProjectDir(gitRoot(project))
  const rel = `projects/${encoded}/memory`
  const dir = join(configDir, 'projects', encoded, 'memory')
  return readTextFiles(
    markdownFiles(dir, 'MEMORY.md').map((name) => [join(dir, name), `${rel}/${name}`] as const),
    dropped,
  )
}

/** Claude Code's project-directory encoding (`session-transcript.ts:52-53` in the SDK). */
function encodeProjectDir(path: string): string {
  return path.replace(/[^a-zA-Z0-9]/g, '-')
}

/** Variables that make git answer for another repository than the one `cwd` is in. */
const GIT_REDIRECTS = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR'] as const

/**
 * The git top-level of `project`, as Claude Code keys auto memory; `project` itself outside a
 * repository or without git. Git's answer is a real path, so a project reached through a symlink
 * keys a different directory inside a repository than outside one, as it does for Claude Code.
 */
function gitRoot(project: string): string {
  const env = { ...process.env }
  for (const name of GIT_REDIRECTS) delete env[name]
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: project,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10_000,
    }).trim()
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { status?: number | null }
    // A non-zero exit (not a repository) or no git binary: the project keys its own memory.
    if (typeof failure.status === 'number' || failure.code === 'ENOENT') return project
    throw error
  }
}
