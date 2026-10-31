import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { loadMcpJson } from '@theokit/agents/bridge'
import { type InlineSkill, type McpServerConfig, Skill } from '@theokit/sdk'
import { stringify as stringifyYaml } from 'yaml'

import { describeError, TheoClawConfigError } from '../control-plane/errors.js'
import { type DroppedEntry, type ForeignSetup, readSkillsDir, SAFE_SKILL_NAME } from './foreign-setup.js'

/** The MCP servers of an import, as `loadMcpJson` returns them (the shape of `@theokit/agents`'s `McpServersMap`). */
export type ImportedMcpServers = Record<string, McpServerConfig>

export interface ImportCounts {
  readonly instructions: number
  readonly memories: number
  readonly skills: number
  readonly mcpServers: number
}

/** What an agent takes from an import (FR-005). */
export interface ImportedSetup {
  readonly kind: ForeignSetup['kind']
  readonly instructions: string
  readonly memory: string
  readonly mcpServers: ImportedMcpServers
  readonly skills: InlineSkill[]
  readonly counts: ImportCounts
}

interface Manifest {
  readonly kind: ForeignSetup['kind']
  readonly source: string
  readonly importedAt: string
  readonly counts: ImportCounts
  readonly dropped: DroppedEntry[]
  readonly skills: string[]
}

const IMPORT = 'import'
const KINDS: ReadonlyArray<ForeignSetup['kind']> = ['claude-code', 'hermes']
const STAGING_PREFIX = 'import.staging-'
const PREVIOUS_PREFIX = 'import.previous-'
const FILES = { manifest: 'manifest.json', instructions: 'instructions.md', memories: 'memories.md', mcp: '.mcp.json' } as const

function writePrivate(path: string, text: string): void {
  writeFileSync(path, text, { mode: 0o600 })
  // After the write, so a umask or an existing file's mode cannot widen it.
  chmodSync(path, 0o600)
}

function mkdirPrivate(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 })
  chmodSync(path, 0o700)
}

function code(error: unknown): string {
  return (error as NodeJS.ErrnoException).code ?? describeError(error)
}

/** The state directory exists at 0700, or the import stops naming it (EC-5). */
function ensureStateDir(stateDir: string): void {
  try {
    mkdirSync(stateDir, { recursive: true, mode: 0o700 })
  } catch (error) {
    throw new TheoClawConfigError(`THEOCLAW_STATE_DIR: cannot create ${stateDir}: ${code(error)}`, { variable: 'THEOCLAW_STATE_DIR' })
  }
}

/**
 * Undo what an interrupted import left (EC-4): with no import, a lone previous copy goes back. With
 * `removeStale`, staging directories and a previous copy beside a present import are removed. Several
 * previous copies and no import are left as found: which one was current is not knowable here.
 */
function recover(stateDir: string, removeStale: boolean): void {
  const names = existsSync(stateDir) ? readdirSync(stateDir) : []
  const previous = names.filter((name) => name.startsWith(PREVIOUS_PREFIX))
  const hasImport = names.includes(IMPORT)
  if (!hasImport && previous.length === 1) renameSync(join(stateDir, previous[0]), join(stateDir, IMPORT))
  if (!removeStale) return
  const stale = names.filter((name) => name.startsWith(STAGING_PREFIX) || (hasImport && name.startsWith(PREVIOUS_PREFIX)))
  for (const name of stale) rmSync(join(stateDir, name), { recursive: true, force: true })
}

/** A skill as staged: its parsed name and description re-emitted, then its body. */
function skillFile(skill: ForeignSetup['skills'][number]): string {
  return `---\n${stringifyYaml({ name: skill.name, description: skill.description })}---\n${skill.body}`
}

function stage(dir: string, setup: ForeignSetup, now: Date): void {
  mkdirPrivate(dir)
  writePrivate(join(dir, FILES.instructions), setup.instructions.map((file) => file.text).join('\n\n'))
  writePrivate(join(dir, FILES.memories), setup.memories.map((file) => file.text).join('\n\n'))
  // Always written, so an import with no server reads back as an empty map (EC-6).
  writePrivate(join(dir, FILES.mcp), `${JSON.stringify({ mcpServers: setup.mcpServers }, null, 2)}\n`)
  mkdirPrivate(join(dir, 'skills'))
  for (const skill of setup.skills) {
    mkdirPrivate(join(dir, 'skills', skill.name))
    writePrivate(join(dir, 'skills', skill.name, 'SKILL.md'), skillFile(skill))
  }
  const manifest: Manifest = {
    kind: setup.kind,
    source: setup.source,
    importedAt: now.toISOString(),
    counts: countsOf(setup),
    dropped: setup.dropped,
    skills: setup.skills.map((skill) => skill.name),
  }
  writePrivate(join(dir, FILES.manifest), `${JSON.stringify(manifest, null, 2)}\n`)
}

function countsOf(setup: ForeignSetup): ImportCounts {
  return {
    instructions: setup.instructions.length,
    memories: setup.memories.length,
    skills: setup.skills.length,
    mcpServers: Object.keys(setup.mcpServers).length,
  }
}

interface Validation {
  /** Why the stage is refused, naming each refused server and never a value; `undefined` when it holds. */
  readonly refusal?: string
  readonly notes: string[]
}

/** The server a `loadMcpJson` warning about `file` names, or `undefined` for one about another file. */
function serverOf(warning: string, file: string): string | undefined {
  const prefix = `${file}: server "`
  if (!warning.startsWith(prefix)) return undefined
  const end = warning.indexOf('"', prefix.length)
  return end === -1 ? undefined : warning.slice(prefix.length, end)
}

/**
 * Sorts `loadMcpJson`'s warnings over the staged file (FR-004). A server it ignored, or a field it
 * does not carry, means the normalisation let a bad entry through: refused. A server the operator
 * policy does not admit is about this machine: a note, and not expected back. Every other warning
 * (an unset `${VAR}`, a malformed policy) is a note. A throw, or a count that differs, refuses too.
 */
function validate(staging: string, staged: number): Validation {
  const file = join(staging, FILES.mcp)
  const warnings: string[] = []
  let servers: ImportedMcpServers
  try {
    servers = loadMcpJson(staging, { onWarn: (warning) => warnings.push(warning), env: process.env })
  } catch (error) {
    return { refusal: `the staged .mcp.json does not read back: ${describeError(error)}`, notes: [] }
  }
  const refused = new Set<string>()
  const notAdmitted = new Set<string>()
  const notes: string[] = []
  for (const warning of warnings) {
    const server = serverOf(warning, file)
    if (server !== undefined && (warning.includes('" ignored — ') || warning.includes('which this runtime does not carry'))) refused.add(server)
    else {
      if (server !== undefined && warning.includes('an operator policy does not admit it')) notAdmitted.add(server)
      notes.push(warning)
    }
  }
  if (refused.size > 0) {
    const names = [...refused].map((name) => `"${name}"`).join(', ')
    return { refusal: `MCP servers refused: ${names} (each is ignored or carries a field the runtime does not)`, notes }
  }
  if (Object.keys(servers).length !== staged - notAdmitted.size) {
    return { refusal: 'the staged MCP server count does not match what loadMcpJson read back', notes }
  }
  return { notes }
}

/** Why a staged skill would not read back as `readImport` reads it, or `undefined` when all do. */
function unreadSkills(staging: string, setup: ForeignSetup): string | undefined {
  const read = new Set(readSkillsDir(join(staging, 'skills'), 'skills', []).map((skill) => skill.name))
  const lost = setup.skills.map((skill) => skill.name).filter((name) => !read.has(name))
  if (lost.length === 0) return undefined
  return `skills refused: ${lost.map((name) => `"${name}"`).join(', ')} (each would not read back once staged)`
}

/** `staging` becomes `<stateDir>/import`; a previous import is kept until the rename succeeded. */
function swap(stateDir: string, staging: string): void {
  const target = join(stateDir, IMPORT)
  const previous = join(stateDir, `${PREVIOUS_PREFIX}${process.pid}`)
  const hadImport = existsSync(target)
  if (hadImport) renameSync(target, previous)
  try {
    renameSync(staging, target)
  } catch (error) {
    if (hadImport) renameSync(previous, target)
    throw error
  }
  if (hadImport) rmSync(previous, { recursive: true, force: true })
}

/**
 * Stage `setup` beside `<stateDir>/import`, validate it through `loadMcpJson`, and replace the
 * import only when it holds (FR-004). A refusal removes the staging directory and leaves a previous
 * import byte-identical (NFR-002); the error names each refused server, never a value.
 */
export function writeImport(stateDir: string, setup: ForeignSetup, opts: { readonly now: Date }): { readonly notes: string[] } {
  ensureStateDir(stateDir)
  recover(stateDir, true)
  const staging = join(stateDir, `${STAGING_PREFIX}${process.pid}-${opts.now.getTime()}`)
  try {
    stage(staging, setup, opts.now)
    const { refusal = unreadSkills(staging, setup), notes } = validate(staging, Object.keys(setup.mcpServers).length)
    if (refusal !== undefined) throw new TheoClawConfigError(`the import was refused, nothing was replaced: ${refusal}`)
    swap(stateDir, staging)
    return { notes }
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

function unreadable(path: string, why: string): TheoClawConfigError {
  return new TheoClawConfigError(`THEOCLAW_STATE_DIR: the import at ${path} ${why}; run the import again`, { variable: 'THEOCLAW_STATE_DIR' })
}

function readManifest(path: string): Manifest {
  let manifest: unknown
  try {
    manifest = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    throw unreadable(path, 'is not valid JSON')
  }
  const shape = manifest as Partial<Manifest> | null
  if (typeof shape !== 'object' || shape === null || !KINDS.includes(shape.kind as ForeignSetup['kind']) || !Array.isArray(shape.skills) || !shape.skills.every(isSafeSkillName) || typeof shape.counts !== 'object' || shape.counts === null) {
    throw unreadable(path, 'is not an import manifest')
  }
  return manifest as Manifest
}

function isSafeSkillName(name: unknown): boolean {
  return typeof name === 'string' && SAFE_SKILL_NAME.test(name)
}

function readStaged(path: string): string {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    throw unreadable(path, 'is missing')
  }
}

/**
 * The import under `<stateDir>/import` as an agent takes it (FR-005), or `undefined` when there is
 * none. The servers are read back through `loadMcpJson`, so the start sees the same warnings the
 * import noted, through `onWarn`; without one they are discarded (the import already printed them).
 */
export function readImport(
  stateDir: string,
  opts: { readonly onWarn?: (warning: string) => void; readonly env?: NodeJS.ProcessEnv } = {},
): ImportedSetup | undefined {
  recover(stateDir, false)
  const dir = join(stateDir, IMPORT)
  const manifestPath = join(dir, FILES.manifest)
  if (!existsSync(manifestPath)) return undefined
  const manifest = readManifest(manifestPath)
  const instructions = readStaged(join(dir, FILES.instructions))
  const memory = readStaged(join(dir, FILES.memories))
  const mcpPath = join(dir, FILES.mcp)
  readStaged(mcpPath)
  let mcpServers: ImportedMcpServers
  try {
    mcpServers = loadMcpJson(dir, { onWarn: opts.onWarn ?? (() => {}), env: opts.env ?? process.env })
  } catch {
    // The cause is not quoted: a JSON.parse message can carry a slice of an env or header value (NFR-003).
    throw unreadable(mcpPath, 'is not a valid MCP file')
  }
  for (const name of manifest.skills) readStaged(join(dir, 'skills', name, 'SKILL.md'))
  const staged = readSkillsDir(join(dir, 'skills'), 'skills', [])
  if (staged.map((skill) => skill.name).sort().join('\n') !== [...manifest.skills].sort().join('\n')) {
    throw unreadable(manifestPath, 'names other skills than the ones staged')
  }
  const skills = staged.map((skill) => Skill.create({ name: skill.name, description: skill.description, instructions: skill.body }))
  return { kind: manifest.kind, instructions, memory, mcpServers, skills, counts: manifest.counts }
}
