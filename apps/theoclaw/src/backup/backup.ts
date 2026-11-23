import { createHash } from 'node:crypto'
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'

import {
  backup as hostBackup,
  BackupError,
  downloadDirectory,
  restore as hostRestore,
  uploadDirectory,
} from '@theokit/host/backup'
import { encodeProjectDir } from '@theokit/sdk/persistence'

import { assertSupportedRuntime } from '../runtime.js'

import { loadConfiguration } from '../config-file.js'
import { resolveInstance } from '../instance.js'
import { takeInstanceLock } from '../instance.js'

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
  /** Called per file (after its copy in a backup, as it is planned in a restore); a test seam to pause or fail midway. */
  readonly onFileCopied?: (path: string) => void
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

function requireSource(path: string, variable: string): void {
  if (!existsSync(path) || !statSync(path).isDirectory()) throw new BackupRefusal(`${variable} ${path} is not a directory`, path)
}

/**
 * Copy an instance's state directory and workspace to `<dir>/state` and `<dir>/workspace`
 * with a sha256 manifest, through `@theokit/host/backup`. SQLite databases use consistent snapshots
 * without their sidecars. Unless live is requested, takes the instance lock and refuses a running
 * instance. Refuses nonempty targets, targets inside either source, and symbolic links. Directories
 * are written 0700 and files 0600 (NFR-003); the migration import is left out (NFR-002). A copy that
 * fails removes what it wrote. The manifest also records the workspace path, so a restore can
 * re-home session transcripts.
 */
export async function backupInstance(env: NodeJS.ProcessEnv, dir: string, options: BackupOptions): Promise<Manifest> {
  assertSupportedRuntime()
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
  const lock = options.live ? undefined : await takeInstanceLock(targets.state)
  try {
    const written = await refusing(() =>
      hostBackup({
        roots: { state: targets.state, workspace: targets.workspace },
        out: target,
        exclude: (root, path) => root === 'state' && !path.includes('/') && excludedFromState(path),
        ...(options.onFileCopied === undefined ? {} : { onFileCopied: (path: string) => options.onFileCopied?.(join(target, path)) }),
      }),
    )
    const manifest: Manifest = { version: 1, files: written.files, workspace: targets.workspace }
    // The host manifest plus the workspace; `roots` stays so the package reads the backup directly.
    writeFileSync(join(target, MANIFEST), `${JSON.stringify({ ...manifest, roots: [...ROOTS] }, null, 2)}\n`, { mode: 0o600 })
    chmodSync(join(target, MANIFEST), 0o600)
    return manifest
  } finally {
    await lock?.release()
  }
}

/** Run a package call, turning its `BackupError` into the refusal the CLI reports. */
async function refusing<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    if (error instanceof BackupError) throw new BackupRefusal(error.message, error.path)
    throw error
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
  const prefix = `.theoclaw/projects/${encodeProjectDir(from)}/`
  return path.startsWith(prefix) ? `.theoclaw/projects/${encodeProjectDir(to)}/${path.slice(prefix.length)}` : path
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

function assertEmptyOrAbsent(path: string): void {
  if (!isEmptyOrAbsent(path)) throw new BackupRefusal(`${path} is not empty; a restore writes only into an empty or absent target`, path)
}

/**
 * The directory the package restores from: the backup itself, or, for a backup written before the
 * package (a manifest without `roots`), a temporary copy whose manifest names them, so the user's
 * backup is never altered.
 */
function packageSource(source: string, manifest: Manifest): { readonly from: string; readonly cleanup: () => void } {
  const raw = JSON.parse(readFileSync(join(source, MANIFEST), 'utf8')) as { roots?: unknown }
  if (Array.isArray(raw.roots)) return { from: source, cleanup: () => undefined }
  const copy = mkdtempSync(join(tmpdir(), 'theoclaw-restore-'))
  const from = join(copy, 'backup')
  const cleanup = (): void => rmSync(copy, { recursive: true, force: true })
  try {
    cpSync(source, from, { recursive: true })
    writeFileSync(join(from, MANIFEST), JSON.stringify({ version: 1, files: manifest.files, roots: [...ROOTS] }), { mode: 0o600 })
  } catch (error) {
    cleanup()
    throw error
  }
  return { from, cleanup }
}

/**
 * Restore a backup into an empty profile (FR-009) through `@theokit/host/backup`: read the manifest,
 * refuse an entry that leaves its root (EC-3) and any file whose sha256 differs, before anything is
 * written; take the instance lock; refuse a non-empty target; the package stages each root beside its
 * target and renames it into place only once every file landed (EC-1), putting the first back if the
 * second fails. Session transcripts are re-homed under the target workspace's name.
 * `onFileCopied` is called once per file as the restore plans it, before anything is written.
 */
export async function restoreInstance(env: NodeJS.ProcessEnv, dir: string, options: BackupOptions): Promise<Manifest> {
  const targets = resolveTargets(env, options.homeDir)
  const source = resolve(dir)
  const manifest = readManifest(source)
  verifyBackup(source, manifest)
  const lock = await takeInstanceLock(targets.state)
  let adapted: ReturnType<typeof packageSource> | undefined
  try {
    assertEmptyOrAbsent(targets.state)
    assertEmptyOrAbsent(targets.workspace)
    adapted = packageSource(source, manifest)
    const from = adapted.from
    await refusing(() =>
      hostRestore({
        from,
        roots: { state: targets.state, workspace: targets.workspace },
        transform: (path, root) => {
          options.onFileCopied?.(join(targets[root as Root], path))
          return root === 'workspace' ? rehomed(path, manifest.workspace, targets.workspace) : path
        },
      }),
    )
    chmodSync(targets.state, 0o700)
    chmodSync(targets.workspace, 0o700)
    return manifest
  } finally {
    adapted?.cleanup()
    await lock.release()
  }
}

/**
 * Upload a verified backup directory to an HTTPS object directory through `@theokit/host/backup`:
 * every file first, the manifest last as the completion marker.
 */
export async function uploadBackup(dir: string, target: string, token?: string): Promise<void> {
  await refusing(() => uploadDirectory(dir, target, token === undefined ? {} : { token }))
}

/** Download to a fresh local directory; verify all bytes before it can be restored. */
export async function downloadBackup(dir: string, target: string, token?: string): Promise<void> {
  await refusing(() => downloadDirectory(dir, target, token === undefined ? {} : { token }))
}
