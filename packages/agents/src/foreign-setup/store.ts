import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { delimiter, join } from 'node:path'

import type { InlineSkill } from '@theokit/sdk'
import { stringify as stringifyYaml } from 'yaml'

import { loadMcpJson } from '../bridge/mcp-file.js'
import type { McpServersMap } from '../types.js'

import type { ForeignSetup, UntranslatedEntry } from './types.js'

import { readForeignSetup } from './index.js'

/** Why a stored import was not written or read: another import holds the lock, the import was refused, or the directory is unreadable. */
export type ForeignImportErrorReason = 'locked' | 'refused' | 'unreadable'

/** Thrown by `writeForeignImport` and `readForeignImport`; its message names a path or a server, never a value. */
export class ForeignImportError extends Error {
  readonly reason: ForeignImportErrorReason
  constructor(message: string, reason: ForeignImportErrorReason) {
    super(message)
    this.name = 'ForeignImportError'
    this.reason = reason
  }
}

function byName(a: string, b: string): number {
  return a.localeCompare(b)
}

function noWarn(): void {
  // warnings are discarded without an onWarn
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The MCP servers of an import, as `loadMcpJson` returns them. */
export type ForeignImportMcpServers = McpServersMap

/** How many entries of each kind the import held when it was written. */
export interface ForeignImportCounts {
  readonly instructions: number
  readonly memories: number
  readonly skills: number
  readonly mcpServers: number
}

/** What an agent takes from a stored import. */
export interface StoredForeignImport {
  readonly kind: ForeignSetup['kind']
  readonly instructions: string
  readonly memory: string
  readonly mcpServers: ForeignImportMcpServers
  readonly skills: InlineSkill[]
  readonly counts: ForeignImportCounts
}

interface Manifest {
  readonly kind: ForeignSetup['kind']
  readonly source: string
  readonly importedAt: string
  readonly counts: ForeignImportCounts
  readonly dropped: UntranslatedEntry[]
  readonly skills: string[]
}

/** A skill name staged as a directory name: no separator, no dot-led name. */
/** Whether `bin` is an executable file in a `PATH` directory. */
function binaryOnPath(bin: string, env: NodeJS.ProcessEnv): boolean {
  const exts = process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : ['']
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (dir === '') continue
    for (const ext of exts) {
      try {
        accessSync(join(dir, bin + ext), constants.X_OK)
        return true
      } catch {
        // not here; keep looking
      }
    }
  }
  return false
}

const SAFE_SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

/** The skills staged under `dir/skills`, read as the shared reader reads a Hermes root. */
function readStagedSkills(dir: string): ForeignSetup['skills'] {
  return readForeignSetup('hermes', { home: dir, configDir: dir }).skills
}

const IMPORT = 'import'
const KINDS: readonly ForeignSetup['kind'][] = ['claude-code', 'hermes']
const STAGING_PREFIX = 'import.staging-'
const PREVIOUS_PREFIX = 'import.previous-'
const LOCK = 'import.lock'
const FILES = {
  manifest: 'manifest.json',
  instructions: 'instructions.md',
  memories: 'memories.md',
  mcp: '.mcp.json',
} as const

/** The files `writeForeignImport` would create under `<dir>/import` (dry run), relative to it. */
export function plannedForeignImportFiles(setup: ForeignSetup): string[] {
  return [
    FILES.instructions,
    FILES.memories,
    FILES.mcp,
    ...setup.skills.map((skill) => `skills/${skill.name}/SKILL.md`),
    FILES.manifest,
  ]
}

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
    throw new ForeignImportError(`cannot create ${stateDir}: ${code(error)}`, 'unreadable')
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
  if (!hasImport && previous.length === 1)
    renameSync(join(stateDir, previous[0]), join(stateDir, IMPORT))
  if (!removeStale) return
  const stale = names.filter(
    (name) => name.startsWith(STAGING_PREFIX) || (hasImport && name.startsWith(PREVIOUS_PREFIX)),
  )
  for (const name of stale) rmSync(join(stateDir, name), { recursive: true, force: true })
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return code(error) === 'EPERM'
  }
}

/** Whether a running process holds `lock`; a lock whose process is gone holds nothing. */
function lockHeld(lock: string): boolean {
  let text: string
  try {
    text = readFileSync(lock, 'utf8')
  } catch (error) {
    if (code(error) === 'ENOENT') return false
    throw error
  }
  const pid = Number(text.trim())
  return Number.isSafeInteger(pid) && pid > 0 && processAlive(pid)
}

/**
 * Take `<stateDir>/import.lock`, so an import and a start's recovery never interleave between a read
 * of the directory and a rename (EC-4). The lock is linked in whole from a file that already holds the
 * pid, so nobody reads it empty; one left by a process that is gone is taken over. Returns the release,
 * or `undefined` while a running process holds it. Two takers of one stale lock can still race, which
 * needs two imports started within the same instant after a crash.
 */
function tryLock(stateDir: string): (() => void) | undefined {
  const lock = join(stateDir, LOCK)
  const claim = `${lock}.${process.pid}`
  writePrivate(claim, `${process.pid}\n`)
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        linkSync(claim, lock)
        return () => {
          rmSync(lock, { force: true })
        }
      } catch (error) {
        if (code(error) !== 'EEXIST' || lockHeld(lock)) break
        rmSync(lock, { force: true })
      }
    }
    return undefined
  } finally {
    rmSync(claim, { force: true })
  }
}

/** A start's `recover`, under the lock: while an import holds it, a lone previous copy is its swap in flight. */
function recoverForRead(stateDir: string, onWarn: (warning: string) => void): void {
  const names = existsSync(stateDir) ? readdirSync(stateDir) : []
  if (
    names.includes(IMPORT) ||
    names.filter((name) => name.startsWith(PREVIOUS_PREFIX)).length !== 1
  )
    return
  const unlock = tryLock(stateDir)
  if (unlock === undefined) {
    onWarn(`an import is being written in ${stateDir}; its previous copy is left as found`)
    return
  }
  try {
    recover(stateDir, false)
  } finally {
    unlock()
  }
}

/** A skill as staged: its parsed name and description re-emitted, then its body. */
function skillFile(skill: ForeignSetup['skills'][number]): string {
  return `---\n${stringifyYaml({ name: skill.name, description: skill.description, ...(skill.requiresBins.length === 0 ? {} : { metadata: { requires: { bins: [...skill.requiresBins] } } }) })}---\n${skill.body}`
}

function stage(dir: string, setup: ForeignSetup, now: Date): void {
  mkdirPrivate(dir)
  writePrivate(
    join(dir, FILES.instructions),
    setup.instructions.map((file) => file.text).join('\n\n'),
  )
  writePrivate(join(dir, FILES.memories), setup.memories.map((file) => file.text).join('\n\n'))
  // Always written, so an import with no server reads back as an empty map (EC-6).
  writePrivate(
    join(dir, FILES.mcp),
    `${JSON.stringify({ mcpServers: setup.mcpServers }, null, 2)}\n`,
  )
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
    dropped: setup.untranslated,
    skills: setup.skills.map((skill) => skill.name),
  }
  writePrivate(join(dir, FILES.manifest), `${JSON.stringify(manifest, null, 2)}\n`)
}

function countsOf(setup: ForeignSetup): ForeignImportCounts {
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
  let servers: ForeignImportMcpServers
  try {
    servers = loadMcpJson(staging, {
      onWarn: (warning) => warnings.push(warning),
      env: process.env,
    })
  } catch (error) {
    return {
      refusal: `the staged .mcp.json does not read back: ${describeError(error)}`,
      notes: [],
    }
  }
  const refused = new Set<string>()
  const notAdmitted = new Set<string>()
  const notes: string[] = []
  for (const warning of warnings) {
    const server = serverOf(warning, file)
    if (
      server !== undefined &&
      (warning.includes('" ignored — ') || warning.includes('which this runtime does not carry'))
    )
      refused.add(server)
    else {
      if (server !== undefined && warning.includes('an operator policy does not admit it'))
        notAdmitted.add(server)
      notes.push(warning)
    }
  }
  if (refused.size > 0) {
    const names = [...refused].map((name) => `"${name}"`).join(', ')
    return {
      refusal: `MCP servers refused: ${names} (each is ignored or carries a field the runtime does not)`,
      notes,
    }
  }
  if (Object.keys(servers).length !== staged - notAdmitted.size) {
    return {
      refusal: 'the staged MCP server count does not match what loadMcpJson read back',
      notes,
    }
  }
  return { notes }
}

/** Why a staged skill would not read back as `readForeignImport` reads it, or `undefined` when all do. */
function unreadSkills(staging: string, setup: ForeignSetup): string | undefined {
  const read = new Set(readStagedSkills(staging).map((skill) => skill.name))
  const lost = setup.skills.map((skill) => skill.name).filter((name) => !read.has(name))
  if (lost.length === 0) return undefined
  const names = lost.map((name) => `"${name}"`).join(', ')
  return `skills refused: ${names} (each would not read back once staged)`
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
export function writeForeignImport(
  stateDir: string,
  setup: ForeignSetup,
  opts: { readonly now?: Date } = {},
): { readonly notes: string[] } {
  const now = opts.now ?? new Date()
  ensureStateDir(stateDir)
  const unlock = tryLock(stateDir)
  if (unlock === undefined) {
    const lock = join(stateDir, LOCK)
    throw new ForeignImportError(
      `another import holds ${lock}; run the import again once it ended`,
      'locked',
    )
  }
  const staging = join(stateDir, `${STAGING_PREFIX}${process.pid}-${now.getTime()}`)
  try {
    // Under the lock, every staging directory and stale previous copy is one an ended import left.
    recover(stateDir, true)
    stage(staging, setup, now)
    const { refusal = unreadSkills(staging, setup), notes } = validate(
      staging,
      Object.keys(setup.mcpServers).length,
    )
    if (refusal !== undefined)
      throw new ForeignImportError(
        `the import was refused, nothing was replaced: ${refusal}`,
        'refused',
      )
    swap(stateDir, staging)
    return { notes }
  } finally {
    rmSync(staging, { recursive: true, force: true })
    unlock()
  }
}

function unreadable(path: string, why: string): ForeignImportError {
  return new ForeignImportError(`the import at ${path} ${why}; run the import again`, 'unreadable')
}

function readManifest(path: string): Manifest {
  let manifest: unknown
  try {
    manifest = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    throw unreadable(path, 'is not valid JSON')
  }
  if (typeof manifest !== 'object' || manifest === null)
    throw unreadable(path, 'is not an import manifest')
  const shape = manifest as Partial<Record<keyof Manifest, unknown>>
  if (
    !KINDS.some((kind) => kind === shape.kind) ||
    !Array.isArray(shape.skills) ||
    !shape.skills.every(isSafeSkillName) ||
    typeof shape.counts !== 'object' ||
    shape.counts === null
  ) {
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
export function readForeignImport(
  stateDir: string,
  opts: { readonly onWarn?: (warning: string) => void; readonly env?: NodeJS.ProcessEnv } = {},
): StoredForeignImport | undefined {
  recoverForRead(stateDir, opts.onWarn ?? noWarn)
  const dir = join(stateDir, IMPORT)
  const manifestPath = join(dir, FILES.manifest)
  if (!existsSync(manifestPath)) return undefined
  const manifest = readManifest(manifestPath)
  const instructions = readStaged(join(dir, FILES.instructions))
  const memory = readStaged(join(dir, FILES.memories))
  const mcpPath = join(dir, FILES.mcp)
  readStaged(mcpPath)
  let mcpServers: ForeignImportMcpServers
  try {
    mcpServers = loadMcpJson(dir, {
      onWarn: opts.onWarn ?? noWarn,
      env: opts.env ?? process.env,
    })
  } catch {
    // The cause is not quoted: a JSON.parse message can carry a slice of an env or header value (NFR-003).
    throw unreadable(mcpPath, 'is not a valid MCP file')
  }
  for (const name of manifest.skills) readStaged(join(dir, 'skills', name, 'SKILL.md'))
  const staged = readStagedSkills(dir)
  if (
    staged
      .map((skill) => skill.name)
      .sort(byName)
      .join('\n') !== [...manifest.skills].sort(byName).join('\n')
  ) {
    throw unreadable(manifestPath, 'names other skills than the ones staged')
  }
  // A skill whose required binary is not on PATH is not offered; reading again after installing it offers it.
  const skills = staged
    .filter((skill) =>
      skill.requiresBins.every((bin) => binaryOnPath(bin, opts.env ?? process.env)),
    )
    .map(
      (skill): InlineSkill => ({
        name: skill.name,
        description: skill.description,
        source: `inline://${skill.name}`,
        instructions: skill.body,
      }),
    )
  return { kind: manifest.kind, instructions, memory, mcpServers, skills, counts: manifest.counts }
}
