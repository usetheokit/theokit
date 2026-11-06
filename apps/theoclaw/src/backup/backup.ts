import { createHash, randomBytes } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { openSync, readSync, closeSync } from 'node:fs'

import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'

import { encodeProjectDir } from '@theokit/sdk/persistence'

import { loadConfiguration } from '../config-file.js'
import { resolveInstance } from '../instance.js'
import { takeInstanceLock } from './instance-lock.js'

/** A backup or a restore that was refused: the reason and the path, never a file's content. */
export class BackupRefusal extends Error {
  constructor(
    message: string,
    readonly path?: string,
  ) {
    super(message)
    this.name = 'BackupRefusal'
  }
}

/** One copied file: its path in the backup (`state/...` or `workspace/...`), its sha256 and size. */
export interface ManifestEntry {
  readonly path: string
  readonly sha256: string
  readonly size: number
}

export interface Manifest {
  readonly version: 1
  readonly files: readonly ManifestEntry[]
  /** The workspace the backup was taken from, so a restore can re-home its session transcripts. */
  readonly workspace?: string
}

export interface BackupOptions {
  readonly homeDir: string
  /** Snapshot SQLite while the instance keeps running. Other files are copied individually. */
  readonly live?: boolean
  /** Called after each file is copied; a test seam to pause a copy or fail it midway. */
  readonly onFileCopied?: (path: string) => void
  /** How a staged target is renamed into place; a test seam to fail the second rename. */
  readonly rename?: (from: string, to: string) => void
}

type Root = 'state' | 'workspace'

interface Targets {
  readonly state: string
  readonly workspace: string
}

const ROOTS: readonly Root[] = ['state', 'workspace']
const MANIFEST = 'manifest.json'

/**
 * Left out of a backup (plan T3.2): the migration import, whose `.mcp.json` holds imported MCP
 * credentials, its staging and previous copies, and its lock with that lock's claim files.
 */
function excludedFromState(name: string): boolean {
  return name === 'import' || name === 'import.lock' || /^import\.(staging|previous|lock)[-.]/.test(name)
}

function blank(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed === '' ? undefined : trimmed
}

/** The state directory and workspace the start would use: the configuration file, then the instance. */
function resolveTargets(source: NodeJS.ProcessEnv, homeDir: string): Targets {
  const env: NodeJS.ProcessEnv = { ...source }
  loadConfiguration(env, homeDir)
  const instance = resolveInstance(env, { homeDir })
  const state = instance.stateDirectory ?? blank(env.THEOCLAW_STATE_DIR)
  const workspace = instance.workspace ?? blank(env.THEOCLAW_WORKSPACE)
  if (state === undefined) throw new BackupRefusal('THEOCLAW_STATE_DIR is unset: there is no state directory to back up or restore into')
  if (workspace === undefined) throw new BackupRefusal('THEOCLAW_WORKSPACE is unset: there is no workspace to back up or restore into')
  const targets = { state: resolve(state), workspace: resolve(workspace) }
  const [realState, realWorkspace] = [realOrResolved(targets.state), realOrResolved(targets.workspace)]
  if (within(realState, realWorkspace) || within(realWorkspace, realState)) {
    throw new BackupRefusal(`THEOCLAW_STATE_DIR ${targets.state} and THEOCLAW_WORKSPACE ${targets.workspace} overlap; each must be outside the other`)
  }
  return targets
}

function mkdirPrivate(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 })
  chmodSync(path, 0o700)
}

function copyPrivate(from: string, to: string): void {
  mkdirPrivate(dirname(to))
  copyFileSync(from, to)
  chmodSync(to, 0o600)
}

function sha256Of(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/** The real path of `path`, through its nearest existing ancestor when it does not exist yet. */
function realOrResolved(path: string): string {
  const absolute = resolve(path)
  if (existsSync(absolute)) return realpathSync(absolute)
  const parent = dirname(absolute)
  return parent === absolute ? absolute : join(realOrResolved(parent), basename(absolute))
}

function within(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent.endsWith(sep) ? parent : `${parent}${sep}`)
}

function isEmptyOrAbsent(path: string): boolean {
  return !existsSync(path) || (statSync(path).isDirectory() && readdirSync(path).length === 0)
}

/** Every regular file under `dir`, relative to it; a symbolic link is refused naming it. */
function listFiles(dir: string, skip: (name: string) => boolean, prefix = ''): string[] {
  const files: string[] = []
  for (const name of readdirSync(dir).sort()) {
    if (prefix === '' && skip(name)) continue
    const path = join(dir, name)
    const entry = lstatSync(path)
    if (entry.isSymbolicLink()) throw new BackupRefusal(`${path} is a symbolic link; a backup follows none`, path)
    if (entry.isDirectory()) files.push(...listFiles(path, skip, join(prefix, name)))
    else if (entry.isFile()) files.push(join(prefix, name))
  }
  return files
}

function requireSource(path: string, variable: string): void {
  if (!existsSync(path) || !statSync(path).isDirectory()) throw new BackupRefusal(`${variable} ${path} is not a directory`, path)
}

/** Detect SQLite by its header, including databases without a conventional extension. */
function isSQLite(path: string): boolean {
  const fd = openSync(path, 'r')
  try {
    const header = Buffer.alloc(16)
    return readSync(fd, header, 0, 16, 0) === 16 && header.toString() === 'SQLite format 3\0'
  } finally { closeSync(fd) }
}

function snapshotSQLite(from: string, to: string): void {
  mkdirPrivate(dirname(to))
  const db = new DatabaseSync(from, { readOnly: true })
  try {
    db.exec('PRAGMA busy_timeout = 5000')
    db.exec(`VACUUM INTO '${to.replaceAll("'", "''")}'`)
    chmodSync(to, 0o600)
  } finally { db.close() }
}

/**
 * Copy an instance's state directory and workspace to `<dir>/state` and `<dir>/workspace`
 * with a sha256 manifest. SQLite databases use consistent snapshots without their sidecars.
 * Unless live is requested, takes the instance lock and refuses a running instance.
 * Refuses nonempty targets, targets inside either source, and symbolic links. Directories are written 0700 and files 0600 (NFR-003); the migration import is
 * left out (NFR-002). A copy that fails removes what it wrote.
 */
export function backupInstance(env: NodeJS.ProcessEnv, dir: string, options: BackupOptions): Manifest {
  const targets = resolveTargets(env, options.homeDir)
  requireSource(targets.state, 'THEOCLAW_STATE_DIR')
  requireSource(targets.workspace, 'THEOCLAW_WORKSPACE')
  const target = resolve(dir)
  const real = realOrResolved(target)
  for (const root of ROOTS) {
    const source = realpathSync(targets[root])
    if (within(real, source)) throw new BackupRefusal(`the backup directory ${target} is inside ${targets[root]}, which it copies`, target)
  }
  if (!isEmptyOrAbsent(target)) throw new BackupRefusal(`the backup directory ${target} is not empty`, target)
  const lock = options.live ? undefined : takeInstanceLock(targets.state)
  const created = !existsSync(target)
  try {
    mkdirPrivate(target)
    const files: ManifestEntry[] = []
    for (const root of ROOTS) {
      mkdirPrivate(join(target, root))
      const sourceFiles = listFiles(targets[root], root === 'state' ? excludedFromState : () => false)
      const databases = new Set(sourceFiles.filter((file) => isSQLite(join(targets[root], file))))
      for (const file of sourceFiles) {
        if (['-wal', '-shm', '-journal'].some((suffix) => file.endsWith(suffix) && databases.has(file.slice(0, -suffix.length)))) continue
        const to = join(target, root, file)
        if (databases.has(file)) snapshotSQLite(join(targets[root], file), to)
        else copyPrivate(join(targets[root], file), to)
        files.push({ path: `${root}/${file.split(sep).join('/')}`, sha256: sha256Of(to), size: statSync(to).size })
        options.onFileCopied?.(to)
      }
    }
    const manifest: Manifest = { version: 1, files, workspace: targets.workspace }
    writeFileSync(join(target, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 })
    chmodSync(join(target, MANIFEST), 0o600)
    return manifest
  } catch (error) {
    if (created) rmSync(target, { recursive: true, force: true })
    else for (const name of [...ROOTS, MANIFEST]) rmSync(join(target, name), { recursive: true, force: true })
    throw error
  } finally {
    lock?.release()
  }
}

function isManifestEntry(value: unknown): value is ManifestEntry {
  const entry = value as Partial<ManifestEntry>
  return typeof entry?.path === 'string' && typeof entry.sha256 === 'string' && typeof entry.size === 'number'
}

function readManifest(dir: string): Manifest {
  const path = join(dir, MANIFEST)
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    throw new BackupRefusal(`${path} is missing or is not a backup manifest`, path)
  }
  const manifest = parsed as Partial<Manifest>
  if (manifest?.version !== 1 || !Array.isArray(manifest.files) || !manifest.files.every(isManifestEntry)) {
    throw new BackupRefusal(`${path} is not a version 1 backup manifest`, path)
  }
  const workspace = typeof manifest.workspace === 'string' ? { workspace: manifest.workspace } : {}
  return { version: 1, files: manifest.files, ...workspace }
}

/** The root and the path under it of a manifest entry, refused when it leaves its root (EC-3). */
function placeOf(entry: ManifestEntry): { readonly root: Root; readonly path: string } {
  const segments = entry.path.split('/')
  const [root, ...rest] = segments
  const escapes = isAbsolute(entry.path) || entry.path.includes('\\') || segments.some((segment) => segment === '..' || segment === '' || segment === '.')
  if (escapes || (root !== 'state' && root !== 'workspace') || rest.length === 0) {
    throw new BackupRefusal(`the manifest entry ${JSON.stringify(entry.path)} leaves state/ and workspace/; nothing was restored`, entry.path)
  }
  return { root, path: rest.join(sep) }
}

/** A file to restore: where it is in the backup, where it goes under its root, and what it must hash to. */
interface Restorable {
  readonly root: Root
  readonly path: string
  readonly from: string
  readonly entry: ManifestEntry
}

/**
 * The session transcripts the SDK keeps under `<workspace>/.theoclaw/projects/<encoded cwd>/`: the
 * directory name encodes the workspace's path, so a backup restored into another workspace moves
 * them under that workspace's own name, or no session would find its history.
 */
function rehomed(path: string, from: string | undefined, to: string): string {
  if (from === undefined) return path
  const prefix = join('.theoclaw', 'projects', encodeProjectDir(from)) + sep
  return path.startsWith(prefix) ? join('.theoclaw', 'projects', encodeProjectDir(to), path.slice(prefix.length)) : path
}

/**
 * Every entry's place, and its bytes checked against the manifest, before anything is written. A
 * file reached through a symbolic link anywhere on its path, inside the backup or as the backup's
 * own `state` or `workspace`, is refused.
 */
function verifyBackup(dir: string, manifest: Manifest): Restorable[] {
  const roots = { state: realpathSync(join(dir, 'state')), workspace: realpathSync(join(dir, 'workspace')) }
  for (const root of ROOTS) {
    if (roots[root] !== join(realpathSync(dir), root)) throw new BackupRefusal(`${join(dir, root)} is a symbolic link; a restore follows none`, root)
  }
  return manifest.files.map((entry) => {
    const place = placeOf(entry)
    const from = join(dir, place.root, place.path)
    const stat = existsSync(from) ? lstatSync(from) : undefined
    if (stat === undefined || !stat.isFile() || realpathSync(from) !== join(roots[place.root], place.path)) {
      throw new BackupRefusal(`${entry.path} is missing from the backup, is not a file or is reached through a symbolic link`, entry.path)
    }
    if (stat.size !== entry.size || sha256Of(from) !== entry.sha256) throw mismatch(entry)
    return { ...place, from, entry }
  })
}

function mismatch(entry: ManifestEntry): BackupRefusal {
  return new BackupRefusal(`${entry.path} does not match its sha256 in the manifest; nothing was restored`, entry.path)
}

/** How a target was before the restore, so a failed rename can put it back. */
interface Before {
  readonly existed: boolean
  readonly mode: number
}

function recordTarget(path: string): Before {
  if (!isEmptyOrAbsent(path)) throw new BackupRefusal(`${path} is not empty; a restore writes only into an empty or absent target`, path)
  return existsSync(path) ? { existed: true, mode: statSync(path).mode & 0o777 } : { existed: false, mode: 0o700 }
}

/** Put a staged copy in place of an absent or empty target. */
function place(staging: string, target: string, rename: (from: string, to: string) => void): void {
  // Empty, as `recordTarget` checked under the lock: `rmdirSync` refuses anything else.
  if (existsSync(target)) rmdirSync(target)
  rename(staging, target)
}

function putBack(target: string, before: Before): void {
  if (before.existed && !existsSync(target)) {
    mkdirSync(target, { recursive: true })
    chmodSync(target, before.mode)
  }
}

/** A staging directory beside `target`, created fresh: one that already exists is never reused. */
function createStaging(target: string): string {
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
  const staging = `${target}.restore-${randomBytes(8).toString('hex')}`
  mkdirSync(staging, { mode: 0o700 })
  chmodSync(staging, 0o700)
  return staging
}

/** Copy every file into its staging root, and check the copy's own bytes against the manifest. */
function stage(files: readonly Restorable[], staging: Record<Root, string>, targets: Targets, manifest: Manifest, options: BackupOptions): void {
  for (const file of files) {
    const path = file.root === 'workspace' ? rehomed(file.path, manifest.workspace, targets.workspace) : file.path
    const to = join(staging[file.root], path)
    copyPrivate(file.from, to)
    if (sha256Of(to) !== file.entry.sha256) throw mismatch(file.entry)
    options.onFileCopied?.(to)
  }
}

/** Both staged roots into place; if the second rename fails, the first target is put back. */
function placeBoth(staging: Record<Root, string>, targets: Targets, before: Record<Root, Before>, rename: (from: string, to: string) => void): void {
  place(staging.state, targets.state, rename)
  try {
    place(staging.workspace, targets.workspace, rename)
  } catch (error) {
    try {
      renameSync(targets.state, staging.state)
      putBack(targets.state, before.state)
      putBack(targets.workspace, before.workspace)
    } catch (rollback) {
      throw new AggregateError([error, rollback], `the restore failed and ${targets.state} could not be put back`)
    }
    throw error
  }
}

/**
 * Restore a backup into an empty profile (FR-009): read the manifest, refuse an entry that leaves
 * its root (EC-3) and any file whose sha256 differs, before anything is written; take the instance
 * lock; refuse a non-empty target; copy each root into a fresh staging directory beside its target,
 * checking each copy's bytes again, and rename it into place only once every file landed (EC-1). If
 * the second rename fails, the first target is put back as it was, so neither target changed.
 */
export function restoreInstance(env: NodeJS.ProcessEnv, dir: string, options: BackupOptions): Manifest {
  const targets = resolveTargets(env, options.homeDir)
  const source = resolve(dir)
  const manifest = readManifest(source)
  const files = verifyBackup(source, manifest)
  const lock = takeInstanceLock(targets.state)
  const staging: Partial<Record<Root, string>> = {}
  try {
    const before = { state: recordTarget(targets.state), workspace: recordTarget(targets.workspace) }
    for (const root of ROOTS) staging[root] = createStaging(targets[root])
    const created = staging as Record<Root, string>
    stage(files, created, targets, manifest, options)
    placeBoth(created, targets, before, options.rename ?? renameSync)
    chmodSync(targets.state, 0o700)
    chmodSync(targets.workspace, 0o700)
    return manifest
  } finally {
    for (const root of ROOTS) if (staging[root] !== undefined) rmSync(staging[root], { recursive: true, force: true })
    lock.release()
  }
}

/** An HTTPS object directory: files first, manifest last as the completion marker. */
function offsiteUrl(target: string, path: string): URL {
  const base = new URL(target.endsWith('/') ? target : `${target}/`)
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) {
    throw new BackupRefusal('THEOCLAW_BACKUP_TARGET must be an HTTPS object directory without credentials, query or fragment')
  }
  return new URL(path.split('/').map(encodeURIComponent).join('/'), base)
}

async function transfer(target: string, path: string, token: string | undefined, body?: Buffer): Promise<Buffer> {
  const response = await fetch(offsiteUrl(target, path), {
    method: body === undefined ? 'GET' : 'PUT',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'If-None-Match': '*' }) },
    ...(body === undefined ? {} : { body: new Uint8Array(body) }),
    redirect: 'error',
    signal: AbortSignal.timeout(60_000),
  })
  if (!response.ok) throw new BackupRefusal(`offsite ${body === undefined ? 'download' : 'upload'} failed (${response.status})`)
  return Buffer.from(await response.arrayBuffer())
}

export async function uploadBackup(dir: string, target: string, token?: string): Promise<void> {
  const manifest = readManifest(dir)
  const files = verifyBackup(dir, manifest)
  for (const file of files) await transfer(target, file.entry.path, token, readFileSync(file.from))
  await transfer(target, MANIFEST, token, readFileSync(join(dir, MANIFEST)))
}

/** Download to a fresh local directory; verify all bytes before it can be restored. */
export async function downloadBackup(dir: string, target: string, token?: string): Promise<void> {
  if (existsSync(dir)) throw new BackupRefusal('offsite download requires an absent local directory', dir)
  mkdirPrivate(dir)
  try {
    writeFileSync(join(dir, MANIFEST), await transfer(target, MANIFEST, token), { mode: 0o600 })
    const manifest = readManifest(dir)
    for (const root of ROOTS) mkdirPrivate(join(dir, root))
    for (const entry of manifest.files) {
      const place = placeOf(entry)
      const to = join(dir, place.root, place.path)
      mkdirPrivate(dirname(to))
      writeFileSync(to, await transfer(target, entry.path, token), { mode: 0o600, flag: 'wx' })
    }
    verifyBackup(dir, manifest)
  } catch (error) {
    rmSync(dir, { recursive: true, force: true })
    throw error
  }
}
