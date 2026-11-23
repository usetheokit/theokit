import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statfsSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'

import { BackupRefusal } from './backup.js'
import { configurationPath } from '../config-file.js'

/** A named place backups are written to: a directory, optionally AES-256-GCM encrypted. */
export interface StorageLocation {
  readonly root: string
  readonly encrypted: boolean
  /** Hex AES-256 key; only present when encrypted. Kept in the 0600 registry, never in the root. */
  readonly key?: string
}

type Registry = Record<string, StorageLocation>

const NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/i
const MAGIC = Buffer.from('TCBK1')

function registryPath(env: NodeJS.ProcessEnv, homeDir: string): string {
  return join(dirname(configurationPath(env, homeDir)), 'storage.json')
}

function readRegistry(env: NodeJS.ProcessEnv, homeDir: string): Registry {
  const path = registryPath(env, homeDir)
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Registry
  } catch {
    throw new BackupRefusal(`${path} is not a storage registry`, path)
  }
}

function writeRegistry(env: NodeJS.ProcessEnv, homeDir: string, registry: Registry): void {
  const path = registryPath(env, homeDir)
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, `${JSON.stringify(registry, null, 2)}\n`, { mode: 0o600 })
  chmodSync(path, 0o600)
}

function lookup(env: NodeJS.ProcessEnv, homeDir: string, name: string): StorageLocation {
  const location = Object.hasOwn(readRegistry(env, homeDir), name)
    ? readRegistry(env, homeDir)[name]
    : undefined
  if (location === undefined)
    throw new BackupRefusal(`no storage location named ${name}; run theoclaw storage init ${name}`)
  return location
}

export function initStorage(
  env: NodeJS.ProcessEnv,
  homeDir: string,
  name: string,
  options: { path?: string; encrypted: boolean },
): StorageLocation {
  if (!NAME.test(name))
    throw new BackupRefusal(`${JSON.stringify(name)} is not a valid storage location name`)
  const registry = readRegistry(env, homeDir)
  if (Object.hasOwn(registry, name))
    throw new BackupRefusal(`storage location ${name} already exists`)
  const root =
    options.path === undefined
      ? join(dirname(registryPath(env, homeDir)), 'storage', name)
      : options.path
  if (!isAbsolute(root)) throw new BackupRefusal('--path must be an absolute directory')
  mkdirSync(root, { recursive: true, mode: 0o700 })
  const location: StorageLocation = options.encrypted
    ? { root: resolve(root), encrypted: true, key: randomBytes(32).toString('hex') }
    : { root: resolve(root), encrypted: false }
  writeRegistry(env, homeDir, { ...registry, [name]: location })
  return location
}

function seal(location: StorageLocation, data: Buffer): Buffer {
  if (!location.encrypted || location.key === undefined) return data
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(location.key, 'hex'), iv)
  const body = Buffer.concat([cipher.update(data), cipher.final()])
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body])
}

function open(location: StorageLocation, data: Buffer): Buffer {
  if (!location.encrypted || location.key === undefined) return data
  if (data.length < MAGIC.length + 28 || !data.subarray(0, MAGIC.length).equals(MAGIC))
    throw new BackupRefusal('the archive is not encrypted by this storage location')
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      Buffer.from(location.key, 'hex'),
      data.subarray(MAGIC.length, MAGIC.length + 12),
    )
    decipher.setAuthTag(data.subarray(MAGIC.length + 12, MAGIC.length + 28))
    return Buffer.concat([decipher.update(data.subarray(MAGIC.length + 28)), decipher.final()])
  } catch {
    throw new BackupRefusal("the archive cannot be decrypted with this storage location's key")
  }
}

interface Payload {
  readonly files: readonly { path: string; data: string }[]
}

function listAll(dir: string, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? listAll(join(dir, entry.name), `${prefix}${entry.name}/`)
      : [`${prefix}${entry.name}`],
  )
}

/** Pack a verified backup directory into one archive in the location; returns the archive path. */
export function storeBackup(
  env: NodeJS.ProcessEnv,
  homeDir: string,
  name: string,
  backupDir: string,
): string {
  const location = lookup(env, homeDir, name)
  const payload: Payload = {
    files: listAll(backupDir).map((path) => ({
      path,
      data: readFileSync(join(backupDir, path)).toString('base64'),
    })),
  }
  const archive = join(
    location.root,
    `backup-${new Date().toISOString().replace(/[:.]/g, '-')}.tcb`,
  )
  writeFileSync(archive, seal(location, Buffer.from(JSON.stringify(payload))), {
    mode: 0o600,
    flag: 'wx',
  })
  return archive
}

/** Unpack the newest archive of the location into the absent directory `dir`. */
export function fetchBackup(
  env: NodeJS.ProcessEnv,
  homeDir: string,
  name: string,
  dir: string,
): void {
  const location = lookup(env, homeDir, name)
  const archives = readdirSync(location.root)
    .filter((file) => /^backup-.*\.tcb$/.test(file))
    .sort()
  const latest = archives.at(-1)
  if (latest === undefined) throw new BackupRefusal(`storage location ${name} holds no backup`)
  const payload = JSON.parse(
    open(location, readFileSync(join(location.root, latest))).toString(),
  ) as Payload
  for (const root of ['state', 'workspace'])
    mkdirSync(join(dir, root), { recursive: true, mode: 0o700 })
  for (const file of payload.files) {
    const to = resolve(dir, file.path)
    if (!to.startsWith(`${resolve(dir)}/`))
      throw new BackupRefusal(
        `the archive entry ${JSON.stringify(file.path)} leaves the backup directory`,
      )
    mkdirSync(dirname(to), { recursive: true, mode: 0o700 })
    writeFileSync(to, Buffer.from(file.data, 'base64'), { mode: 0o600 })
  }
}

export interface StorageStatus {
  readonly name: string
  readonly state: 'ok' | 'error'
  readonly encrypted: boolean
  readonly sizeBytes?: number
  readonly freeBytes?: number
  readonly totalBytes?: number
  readonly error?: string
}

function space(root: string): { freeBytes?: number; totalBytes?: number } {
  try {
    const fs = statfsSync(root)
    return { freeBytes: fs.bavail * fs.bsize, totalBytes: fs.blocks * fs.bsize }
  } catch {
    return {}
  }
}

/** Write, read back, decrypt and remove a probe; `sizeBytes` is the probe's size on disk. */
export function testStorage(env: NodeJS.ProcessEnv, homeDir: string, name: string): StorageStatus {
  const location = lookup(env, homeDir, name)
  const probe = join(location.root, `.probe-${randomBytes(6).toString('hex')}`)
  const plain = randomBytes(32)
  try {
    writeFileSync(probe, seal(location, plain), { mode: 0o600, flag: 'wx' })
    const stored = readFileSync(probe)
    if (!open(location, stored).equals(plain)) throw new Error('the probe did not read back')
    return {
      name,
      state: 'ok',
      encrypted: location.encrypted,
      sizeBytes: statSync(probe).size,
      ...space(location.root),
    }
  } catch (error) {
    return {
      name,
      state: 'error',
      encrypted: location.encrypted,
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    rmSync(probe, { force: true })
  }
}

export function listStorage(env: NodeJS.ProcessEnv, homeDir: string): StorageStatus[] {
  return Object.entries(readRegistry(env, homeDir)).map(([name, location]) =>
    existsSync(location.root)
      ? { name, state: 'ok' as const, encrypted: location.encrypted, ...space(location.root) }
      : {
          name,
          state: 'error' as const,
          encrypted: location.encrypted,
          error: `${location.root} is missing`,
        },
  )
}

/** A scratch directory name for staging a backup on its way to or from a location. */
export function scratchDir(): string {
  return join(mkdtempSync(join(tmpdir(), 'theoclaw-storage-')), 'backup')
}
