import { execFileSync } from 'node:child_process'
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  openSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs'
import { join, resolve } from 'node:path'

import { isPair, parseDocument, parse as parseYaml, visit } from 'yaml'

import { parseClaudeHooks } from '../hooks/claude-hooks.js'

import type {
  ForeignHook,
  ForeignMcpServer,
  ForeignSetup,
  ForeignSetupKind,
  ForeignSkill,
  ForeignTextFile,
  ReadForeignSetupOptions,
  UntranslatedEntry,
} from './types.js'

export type * from './types.js'

/** Every file read is capped at this many bytes. */
const FILE_CAP = 262_144
const SAFE_SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const FRONTMATTER = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/

type Raw = Record<string, unknown>
type Out = UntranslatedEntry[]

function isRecord(value: unknown): value is Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readCapped(path: string, rel: string, out: Out): string | undefined {
  let fd: number
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  try {
    const stat = fstatSync(fd)
    if (!stat.isFile()) return undefined
    if (stat.size > FILE_CAP) {
      out.push({ path: rel, reason: `file over ${String(FILE_CAP)} bytes` })
      return undefined
    }
    return readFileSync(fd, 'utf8')
  } finally {
    closeSync(fd)
  }
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function textFiles(files: readonly (readonly [string, string])[], out: Out): ForeignTextFile[] {
  const read: ForeignTextFile[] = []
  for (const [path, rel] of files) {
    const text = readCapped(path, rel, out)
    if (text !== undefined) read.push({ path: rel, text })
  }
  return read
}

/** The `metadata.requires.bins` strings of a skill's frontmatter; none when absent or malformed. */
function requiredBins(metadata: unknown): string[] {
  if (!isRecord(metadata) || !isRecord(metadata.requires)) return []
  const { bins } = metadata.requires
  return Array.isArray(bins)
    ? bins.filter((b): b is string => typeof b === 'string' && b !== '')
    : []
}

function parseSkill(
  text: string,
  taken: ReadonlySet<string>,
): { skill: Omit<ForeignSkill, 'path'> } | { reason: string } {
  const lacks = { reason: 'frontmatter lacks name or description' }
  const match = FRONTMATTER.exec(text)
  if (match === null) return lacks
  let front: unknown
  try {
    front = parseYaml(match[1])
  } catch {
    return lacks
  }
  const { name, description, metadata } = isRecord(front) ? front : ({} as Raw)
  if (typeof name !== 'string' || typeof description !== 'string') return lacks
  if (!SAFE_SKILL_NAME.test(name)) return { reason: 'skill name is not a safe directory name' }
  if (taken.has(name)) return { reason: 'duplicated name' }
  return {
    skill: {
      name,
      description,
      body: text.slice(match[0].length),
      requiresBins: requiredBins(metadata),
    },
  }
}

function readSkillsDir(dir: string, relBase: string, out: Out): ForeignSkill[] {
  let names: string[] = []
  try {
    names = readdirSync(dir)
      .filter((name) => isDir(join(dir, name)))
      .sort((a, b) => a.localeCompare(b))
  } catch {
    return []
  }
  const skills: ForeignSkill[] = []
  const taken = new Set<string>()
  for (const directory of names) {
    const rel = `${relBase}/${directory}/SKILL.md`
    const path = join(dir, directory, 'SKILL.md')
    if (!isFile(path)) {
      out.push({ path: `${relBase}/${directory}`, reason: 'no SKILL.md' })
      continue
    }
    const text = readCapped(path, rel, out)
    if (text === undefined) continue
    const parsed = parseSkill(text, taken)
    if ('reason' in parsed) {
      out.push({ path: rel, reason: parsed.reason })
      continue
    }
    taken.add(parsed.skill.name)
    skills.push({ ...parsed.skill, path: rel })
  }
  return skills
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined
  const entries = Object.entries(value)
  if (!entries.every(([, v]) => ['string', 'number', 'boolean'].includes(typeof v)))
    return undefined
  return Object.fromEntries(entries.map(([k, v]) => [k, String(v)]))
}

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v !== ''

function drop(out: Out, path: string, reason: string): undefined {
  out.push({ path, reason })
  return undefined
}

function noteLeftover(raw: Raw, carried: ReadonlySet<string>, at: string, out: Out): void {
  for (const key of Object.keys(raw))
    if (!carried.has(key)) out.push({ path: `${at}.${key}`, reason: 'field not carried' })
}

function translateStdio(raw: Raw, at: string, out: Out): ForeignMcpServer | undefined {
  const { args, cwd } = raw
  if (args !== undefined && !(Array.isArray(args) && args.every((a) => typeof a === 'string'))) {
    drop(out, at, 'args is not an array of strings')
    return
  }
  const env = raw.env === undefined ? undefined : stringRecord(raw.env)
  if (raw.env !== undefined && env === undefined) {
    drop(out, at, 'env value is not a string, number or boolean')
    return
  }
  const carried = new Set(['command', 'args', 'env'])
  if (typeof cwd === 'string') carried.add('cwd')
  if (raw.type === 'stdio') carried.add('type')
  noteLeftover(raw, carried, at, out)
  return {
    command: raw.command as string,
    ...(args === undefined ? {} : { args: [...args] }),
    ...(env === undefined ? {} : { env }),
    ...(typeof cwd === 'string' ? { cwd } : {}),
  }
}

function translateUrl(raw: Raw, at: string, out: Out): ForeignMcpServer | undefined {
  if (!isHttpUrl(raw.url as string)) {
    drop(out, at, 'url is not http: or https:')
    return
  }
  const type =
    raw.type === undefined || raw.type === 'http' || raw.type === 'streamable-http'
      ? 'http'
      : raw.type
  if (type !== 'http' && type !== 'sse') {
    drop(out, at, 'transport is not http or sse')
    return
  }
  const headers = raw.headers === undefined ? undefined : stringRecord(raw.headers)
  if (raw.headers !== undefined && headers === undefined) {
    drop(out, at, 'headers value is not a string, number or boolean')
    return
  }
  noteLeftover(raw, new Set(['type', 'url', 'headers']), at, out)
  return { type, url: raw.url as string, ...(headers === undefined ? {} : { headers }) }
}

/** The framework shape of one foreign MCP entry, or why it cannot be represented. */
function translateMcp(
  raw: unknown,
  file: string,
  name: string,
  out: Out,
): ForeignMcpServer | undefined {
  const at = `${file}#${name}`
  if (!isRecord(raw)) {
    drop(out, at, 'not an object')
    return
  }
  const hasCommand = nonEmpty(raw.command)
  if (hasCommand === nonEmpty(raw.url)) {
    drop(out, at, hasCommand ? 'both command and url' : 'neither command nor url')
    return
  }
  return hasCommand ? translateStdio(raw, at, out) : translateUrl(raw, at, out)
}

function translateMcpMap(map: Raw, file: string, out: Out): Record<string, ForeignMcpServer> {
  const servers: Record<string, ForeignMcpServer> = {}
  for (const [name, raw] of Object.entries(map)) {
    const server = translateMcp(raw, file, name, out)
    if (server !== undefined) servers[name] = server
  }
  return servers
}

/** The `mcpServers` map of a JSON file; `{}` when there is none. */
function readJsonMcp(path: string, rel: string, out: Out): Raw {
  const text = readCapped(path, rel, out)
  if (text === undefined) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    out.push({ path: rel, reason: 'not valid JSON' })
    return {}
  }
  if (!isRecord(parsed)) {
    out.push({ path: rel, reason: 'not a JSON object' })
    return {}
  }
  if (parsed.mcpServers === undefined) return {}
  if (!isRecord(parsed.mcpServers)) {
    out.push({ path: rel, reason: 'mcpServers is not an object' })
    return {}
  }
  return parsed.mcpServers
}

function readClaudeHooks(path: string, rel: string, out: Out): ForeignHook[] {
  const text = readCapped(path, rel, out)
  if (text === undefined) return []
  let settings: unknown
  try {
    settings = JSON.parse(text)
  } catch {
    out.push({ path: rel, reason: 'not valid JSON' })
    return []
  }
  if (!isRecord(settings)) return []
  const parsed = parseClaudeHooks(settings.hooks)
  for (const reason of parsed.dropped) out.push({ path: `${rel}#hooks`, reason })
  return parsed.specs.map((spec) => ({
    event: spec.event,
    command: spec.command,
    ...(spec.matcher === undefined ? {} : { matcher: spec.matcher }),
    timeoutMs: spec.timeout_ms,
  }))
}

/** The `*.md` regular files directly under `dir`, `first` (when present) ahead of the rest by name. */
function markdownFiles(dir: string, first: string): string[] {
  let names: string[] = []
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  const files = names
    .filter((n) => n.endsWith('.md') && isFile(join(dir, n)))
    .sort((a, b) => a.localeCompare(b))
  return files.includes(first) ? [first, ...files.filter((n) => n !== first)] : files
}

/** Variables that make git answer for another repository than the one `cwd` is in. */
const GIT_REDIRECTS = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR'] as const

/** The git top-level of `project`, as Claude Code keys auto memory; `project` itself outside a repository or without git. */
function gitRoot(project: string): string {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !(GIT_REDIRECTS as readonly string[]).includes(name),
    ),
  )
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- git is looked up on PATH, as Claude Code does
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: project,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10_000,
    }).trim()
  } catch {
    // not a repository, no git, a hung or killed git: key by the project path itself
    return project
  }
}

/** The auto memory: `*.md` directly under `projects/<encoded git root>/memory`, `MEMORY.md` first. */
function readClaudeMemories(dir: string, cwd: string, out: Out): ForeignTextFile[] {
  const encoded = gitRoot(cwd).replace(/[^a-zA-Z0-9]/g, '-')
  const rel = `projects/${encoded}/memory`
  const memoryDir = join(dir, 'projects', encoded, 'memory')
  return textFiles(
    markdownFiles(memoryDir, 'MEMORY.md').map((n) => [join(memoryDir, n), `${rel}/${n}`] as const),
    out,
  )
}

/** `user` without the names `project` carries; each shadowed one is listed as untranslated. */
function mergeMcp(
  user: Record<string, ForeignMcpServer>,
  project: Record<string, ForeignMcpServer>,
  out: Out,
): Record<string, ForeignMcpServer> {
  const kept: Record<string, ForeignMcpServer> = {}
  for (const [name, server] of Object.entries(user)) {
    if (Object.hasOwn(project, name))
      out.push({ path: `.claude.json#${name}`, reason: 'shadowed by the project scope' })
    else kept[name] = server
  }
  return { ...kept, ...project }
}

function readClaude(
  home: string,
  dir: string,
  cwd: string | undefined,
  out: Out,
): Omit<ForeignSetup, 'kind' | 'source' | 'untranslated'> {
  const instructionFiles: (readonly [string, string])[] = [[join(dir, 'CLAUDE.md'), 'CLAUDE.md']]
  if (cwd !== undefined) {
    instructionFiles.push(
      [join(cwd, 'CLAUDE.md'), 'project/CLAUDE.md'],
      [join(cwd, '.claude', 'CLAUDE.md'), 'project/.claude/CLAUDE.md'],
    )
  }
  const user = translateMcpMap(
    readJsonMcp(join(home, '.claude.json'), '.claude.json', out),
    '.claude.json',
    out,
  )
  const project =
    cwd === undefined
      ? {}
      : translateMcpMap(
          readJsonMcp(join(cwd, '.mcp.json'), 'project/.mcp.json', out),
          'project/.mcp.json',
          out,
        )
  const mcpServers = mergeMcp(user, project, out)
  const skills = new Map(readSkillsDir(join(dir, 'skills'), 'skills', out).map((s) => [s.name, s]))
  if (cwd !== undefined) {
    for (const s of readSkillsDir(join(cwd, '.claude', 'skills'), 'project/.claude/skills', out)) {
      const shadowed = skills.get(s.name)
      if (shadowed !== undefined)
        out.push({ path: shadowed.path, reason: 'shadowed by the project scope' })
      skills.set(s.name, s)
    }
  }
  const hooks = [
    ...readClaudeHooks(join(dir, 'settings.json'), 'settings.json', out),
    ...(cwd === undefined
      ? []
      : readClaudeHooks(
          join(cwd, '.claude', 'settings.json'),
          'project/.claude/settings.json',
          out,
        )),
  ]
  return {
    instructions: textFiles(instructionFiles, out),
    skills: [...skills.values()].sort((a, b) => (a.name < b.name ? -1 : 1)),
    mcpServers,
    memories: cwd === undefined ? [] : readClaudeMemories(dir, cwd, out),
    hooks,
  }
}

/** `config.yaml` read as YAML 1.1 does: merge keys apply; numbers written as map values keep their source text. */
function parseHermesConfig(text: string): unknown {
  const doc = parseDocument(text, { merge: true, uniqueKeys: false })
  if (doc.errors.length > 0) throw doc.errors[0]
  visit(doc, {
    Scalar(_index, node, path) {
      const parent = path[path.length - 1]
      if (
        typeof node.value === 'number' &&
        node.source !== undefined &&
        isPair(parent) &&
        parent.value === node
      )
        node.value = node.source
    },
  })
  return doc.toJS() as unknown
}

function readHermes(
  root: string,
  out: Out,
): Omit<ForeignSetup, 'kind' | 'source' | 'untranslated'> {
  const instructions = textFiles(
    [
      [join(root, 'SOUL.md'), 'SOUL.md'],
      [join(root, 'AGENTS.md'), 'AGENTS.md'],
    ],
    out,
  )
  let mcpServers: Record<string, ForeignMcpServer> = {}
  const text = readCapped(join(root, 'config.yaml'), 'config.yaml', out)
  if (text !== undefined) {
    try {
      const config = parseHermesConfig(text)
      if (isRecord(config)) {
        const mcp = config.mcp
        const map = [config.mcp_servers, isRecord(mcp) ? mcp.servers : undefined, mcp].find(
          isRecord,
        )
        mcpServers = translateMcpMap(map ?? {}, 'config.yaml', out)
      }
    } catch {
      out.push({ path: 'config.yaml', reason: 'not valid YAML' })
    }
  }
  const skills = readSkillsDir(join(root, 'skills'), 'skills', out)
  // Hermes keeps its channels here; none of them is imported.
  for (const entry of ['platforms', 'channel_directory.json'])
    if (existsSync(join(root, entry)))
      out.push({ path: entry, reason: 'channels are not imported' })
  return {
    instructions,
    skills,
    mcpServers,
    memories: textFiles(
      [
        [join(root, 'memories', 'MEMORY.md'), 'memories/MEMORY.md'],
        [join(root, 'memories', 'USER.md'), 'memories/USER.md'],
      ],
      out,
    ),
    hooks: [],
  }
}

/**
 * Reads another agent's setup (`claude-code` under `<home>/.claude` and `<home>/.claude.json`, plus the
 * project scope under `cwd`; `hermes` under `<home>/.hermes`; `configDir` replaces either directory) into a neutral shape, with every entry it
 * could not translate and why. Read-only: nothing is written and no hook or server is run.
 */
export function readForeignSetup(
  kind: ForeignSetupKind,
  options: ReadForeignSetupOptions,
): ForeignSetup {
  const untranslated: UntranslatedEntry[] = []
  const source =
    options.configDir ?? join(options.home, kind === 'claude-code' ? '.claude' : '.hermes')
  const cwd = options.cwd === undefined ? undefined : resolve(options.cwd)
  const read =
    kind === 'claude-code'
      ? readClaude(options.home, source, cwd, untranslated)
      : readHermes(source, untranslated)
  return { kind, source, ...read, untranslated }
}
