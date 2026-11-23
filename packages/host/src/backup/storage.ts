import { randomBytes } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { chmod, readdir, readFile, rename, rm, rmdir, stat, statfs } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { replaceFileAtomic } from '@theokit/sdk/persistence'

import { packDirectory, unpackInto, verifyBackupDir } from './archive.js'
import { BackupError } from './errors.js'
import { MANIFEST_NAME } from './manifest.js'
import { isEmptyOrAbsent, mkdirPrivate, tempSibling } from './paths.js'
import {
  checkRemoteUrl,
  isRemoteRoot,
  remoteDownload,
  remoteGet,
  remoteList,
  remotePut,
  type RemoteLocation,
} from './remote-storage.js'
import { keyOf, newKey, openSealed, seal, type SealOptions } from './seal.js'

export interface StorageLocation {
  readonly root: string
  readonly encrypted: boolean
}

export interface StorageRegistry {
  /** A `root` starting with `https://` is a remote directory; `token` is its bearer credential. */
  init(
    name: string,
    options: { root?: string; encrypted: boolean; token?: string },
  ): Promise<StorageLocation>
  store(name: string, backupDir: string): Promise<string>
  fetchLatest(name: string, into: string): Promise<void>
  test(
    name: string,
  ): Promise<{ ok: true; sizeBytes: number; freeBytes?: number } | { ok: false; reason: string }>
  list(): Promise<readonly (StorageLocation & { name: string })[]>
}

interface Entry {
  root: string
  encrypted: boolean
  key?: string
  token?: string
}

const NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/
const ARCHIVE = /^backup-\d{8}T\d{9}Z-[0-9a-f]{8}\.tcbk$/
/** Written after the archive is fully uploaded; an archive without it is not a backup. */
const MARKER = /^(backup-\d{8}T\d{9}Z-[0-9a-f]{8}\.tcbk)\.manifest\.json$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function checkName(name: string): void {
  if (!NAME.test(name)) throw new BackupError('storage name must match [a-z0-9][a-z0-9_-]{0,63}')
}

function archiveName(): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('.', '')
  return `backup-${stamp}-${randomBytes(4).toString('hex')}.tcbk`
}

async function archives(root: string): Promise<string[]> {
  const names = await readdir(root).catch((cause: unknown) => {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw new BackupError(`cannot read storage ${root}`, { path: root, cause })
  })
  return names.filter((n) => ARCHIVE.test(n)).sort((x, y) => x.localeCompare(y))
}

/**
 * Named backup locations kept in `file` (0600, holds the AES key of each encrypted location);
 * a location with no `root` lives at `<defaultRoot>/<name>`.
 */
export function createStorageRegistry(options: {
  file: string
  defaultRoot: string
  /** PEM certificate authorities trusted for remote locations, besides the system's. */
  ca?: string
}): StorageRegistry {
  async function read(): Promise<Record<string, Entry>> {
    let text: string
    try {
      text = await readFile(options.file, 'utf8')
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return {}
      throw new BackupError(`cannot read ${options.file}`, { path: options.file, cause })
    }
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch (cause) {
      throw new BackupError(`${options.file} is not valid JSON`, { path: options.file, cause })
    }
    const locations = isRecord(value) ? value.locations : undefined
    if (!isRecord(locations)) {
      throw new BackupError(`${options.file} is not a storage registry`, { path: options.file })
    }
    const out: Record<string, Entry> = {}
    for (const [name, raw] of Object.entries(locations)) {
      if (!isRecord(raw) || typeof raw.root !== 'string' || typeof raw.encrypted !== 'boolean') {
        throw new BackupError(`${options.file} holds a malformed location "${name}"`, {
          path: options.file,
        })
      }
      out[name] = {
        root: raw.root,
        encrypted: raw.encrypted,
        ...(typeof raw.key === 'string' ? { key: raw.key } : {}),
        ...(typeof raw.token === 'string' ? { token: raw.token } : {}),
      }
    }
    return out
  }

  async function write(locations: Record<string, Entry>): Promise<void> {
    await mkdirPrivate(path.dirname(options.file))
    await replaceFileAtomic(
      options.file,
      `${JSON.stringify({ version: 1, locations }, null, 2)}\n`,
      {
        mode: 0o600,
      },
    )
  }

  async function get(name: string): Promise<{ entry: Entry; seal: SealOptions }> {
    checkName(name)
    const locations = await read()
    if (!Object.hasOwn(locations, name)) {
      throw new BackupError(`no storage location named "${name}"`)
    }
    const entry = locations[name]
    const sealOptions: SealOptions = {
      encrypted: entry.encrypted,
      ...(entry.key === undefined ? {} : { key: entry.key }),
    }
    return { entry, seal: sealOptions }
  }

  function remoteOf(entry: Entry): RemoteLocation | undefined {
    if (!isRemoteRoot(entry.root)) return undefined
    return {
      url: entry.root,
      ...(entry.token === undefined ? {} : { token: entry.token }),
      ...(options.ca === undefined ? {} : { ca: options.ca }),
    }
  }

  /** The newest archive whose completion marker exists. */
  async function latestRemote(remote: RemoteLocation): Promise<string | undefined> {
    const names = await remoteList(remote)
    return names
      .map((n) => MARKER.exec(n)?.[1])
      .filter((n): n is string => n !== undefined)
      .sort((x, y) => x.localeCompare(y))
      .at(-1)
  }

  return {
    async init(name, init) {
      checkName(name)
      const locations = await read()
      if (Object.hasOwn(locations, name)) {
        throw new BackupError(`storage location "${name}" already exists`)
      }
      const remote = init.root !== undefined && isRemoteRoot(init.root)
      if (remote) checkRemoteUrl(init.root!)
      const root = remote
        ? init.root!
        : path.resolve(init.root ?? path.join(options.defaultRoot, name))
      const entry: Entry = { root, encrypted: init.encrypted }
      if (init.encrypted) entry.key = newKey()
      if (remote && init.token !== undefined) entry.token = init.token
      if (!remote) await mkdirPrivate(root)
      await write({ ...locations, [name]: entry })
      return { root, encrypted: init.encrypted }
    },

    async store(name, backupDir) {
      const { entry, seal: sealOptions } = await get(name)
      keyOf(sealOptions) // a damaged registry fails here, before any byte is written
      await verifyBackupDir(backupDir)
      const remote = remoteOf(entry)
      if (remote !== undefined) {
        const archive = archiveName()
        try {
          await remotePut(remote, archive, seal(packDirectory(backupDir), sealOptions))
          // The marker goes last: until it exists the archive is not listed as a backup.
          await remotePut(
            remote,
            `${archive}.manifest.json`,
            await readFile(path.join(backupDir, MANIFEST_NAME)),
          )
        } catch (error) {
          throw error instanceof BackupError
            ? error
            : new BackupError(`cannot store the backup in "${name}"`, { cause: error })
        }
        return `${entry.root.replace(/\/$/, '')}/${archive}`
      }
      await mkdirPrivate(entry.root)
      const final = path.join(entry.root, archiveName())
      const partial = path.join(entry.root, `.partial-${randomBytes(6).toString('hex')}`)
      try {
        const stream = Readable.from(seal(packDirectory(backupDir), sealOptions))
        await pipeline(stream, createWriteStream(partial, { flags: 'wx', mode: 0o600 }))
        await rename(partial, final)
      } catch (error) {
        await rm(partial, { force: true }).catch(() => undefined)
        throw error instanceof BackupError
          ? error
          : new BackupError(`cannot store the backup in "${name}"`, {
              path: entry.root,
              cause: error,
            })
      }
      return final
    },

    async fetchLatest(name, into) {
      const { entry, seal: sealOptions } = await get(name)
      const target = path.resolve(into)
      const remote = remoteOf(entry)
      const latest =
        remote === undefined ? (await archives(entry.root)).at(-1) : await latestRemote(remote)
      if (latest === undefined) {
        throw new BackupError(`storage location "${name}" holds no backup`, { path: entry.root })
      }
      if (!(await isEmptyOrAbsent(target))) {
        throw new BackupError(`${target} is not empty`, { path: target })
      }
      const staging = tempSibling(target, 'fetch')
      const download = `${staging}.tcbk`
      try {
        await mkdirPrivate(staging)
        await chmod(staging, 0o700)
        let source = path.join(entry.root, latest)
        if (remote !== undefined) {
          await remoteDownload(remote, latest, download)
          await remoteGet(remote, `${latest}.manifest.json`) // the completion marker must be readable
          source = download
        }
        await unpackInto(openSealed(source, sealOptions), staging)
        await verifyBackupDir(staging)
        if (!(await isEmptyOrAbsent(target))) {
          throw new BackupError(`${target} is not empty`, { path: target })
        }
        await rmdir(target).catch(() => undefined)
        await rename(staging, target)
        await rm(download, { force: true }).catch(() => undefined)
      } catch (error) {
        await rm(staging, { recursive: true, force: true }).catch(() => undefined)
        await rm(download, { force: true }).catch(() => undefined)
        throw error instanceof BackupError
          ? error
          : new BackupError(`cannot fetch the backup from "${name}"`, {
              path: target,
              cause: error,
            })
      }
    },

    async test(name) {
      let probe: string | undefined
      try {
        const { entry, seal: sealOptions } = await get(name)
        const remote = remoteOf(entry)
        if (remote !== undefined) {
          keyOf(sealOptions)
          await remoteList(remote) // reachable, authorized and well-formed; no probe is left behind
          return { ok: true, sizeBytes: 0 }
        }
        await mkdirPrivate(entry.root)
        probe = path.join(entry.root, `.probe-${randomBytes(6).toString('hex')}`)
        const bytes = randomBytes(1024)
        await pipeline(
          Readable.from(seal(Readable.from([bytes]) as AsyncIterable<Buffer>, sealOptions)),
          createWriteStream(probe, { flags: 'wx', mode: 0o600 }),
        )
        const back: Buffer[] = []
        for await (const chunk of openSealed(probe, sealOptions)) back.push(chunk)
        if (!Buffer.concat(back).equals(bytes)) {
          return { ok: false, reason: 'the probe did not read back as written' }
        }
        await rm(probe, { force: true })
        probe = undefined
        let sizeBytes = 0
        for (const file of await archives(entry.root)) {
          sizeBytes += (await stat(path.join(entry.root, file))).size
        }
        const free = await statfs(entry.root).then(
          (s) => s.bavail * s.bsize,
          () => undefined,
        )
        return { ok: true, sizeBytes, ...(free === undefined ? {} : { freeBytes: free }) }
      } catch (error) {
        if (probe !== undefined) await rm(probe, { force: true }).catch(() => undefined)
        return { ok: false, reason: error instanceof Error ? error.message : String(error) }
      }
    },

    async list() {
      const locations = await read()
      return Object.keys(locations)
        .sort((x, y) => x.localeCompare(y))
        .map((name) => ({
          name,
          root: locations[name].root,
          encrypted: locations[name].encrypted,
        }))
    },
  }
}
