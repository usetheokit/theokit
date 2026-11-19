import { copyFile, chmod, lstat, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { replaceFileAtomic } from '@theokit/sdk/persistence'

import { BackupError } from './errors.js'
import { MANIFEST_NAME, sha256File, type BackupManifest, type ManifestEntry } from './manifest.js'
import {
  assertDisjoint,
  isEmptyOrAbsent,
  listFiles,
  mkdirPrivate,
  realOrResolved,
  validateRoots,
  type BackupRoots,
} from './paths.js'
import { isSQLite, sidecarOf, snapshotSQLite } from './sqlite.js'

export type BackupLock = () => Promise<() => Promise<void>> | (() => Promise<void>)

export interface BackupOptions {
  readonly roots: BackupRoots
  readonly out: string
  readonly exclude?: (root: string, relativePath: string) => boolean
  readonly lock?: BackupLock
  readonly onFileCopied?: (path: string) => void
}

/** Run `work` holding the lock: acquired first, released after success or failure. */
export async function withLock<T>(
  lock: BackupLock | undefined,
  work: () => Promise<T>,
): Promise<T> {
  const release = lock === undefined ? undefined : await lock()
  try {
    return await work()
  } finally {
    await release?.()
  }
}

async function copyOne(source: string, target: string): Promise<void> {
  await mkdirPrivate(dirname(target))
  if (isSQLite(source)) await snapshotSQLite(source, target)
  else await copyFile(source, target)
  await chmod(target, 0o600)
}

/**
 * Copy each root to `<out>/<name>` with a sha256 `manifest.json`. SQLite databases are snapshotted
 * without their sidecars. Refuses a non-empty `out`, an `out` overlapping a root, and symbolic links.
 * A failure removes what was written.
 */
export async function backup(options: BackupOptions): Promise<BackupManifest> {
  validateRoots(options.roots)
  const names = Object.keys(options.roots).sort((x, y) => x.localeCompare(y))
  return withLock(options.lock, async () => {
    // Every filesystem read, the overlap check included, happens holding the lock.
    assertDisjoint([
      ...names.map((name) => [`root "${name}"`, options.roots[name]] as const),
      ['output', options.out],
    ])
    if (!(await isEmptyOrAbsent(options.out))) {
      throw new BackupError(`output ${options.out} is not empty`, { path: options.out })
    }
    const out = realOrResolved(options.out)
    const existed = await stat(out).then(
      () => true,
      () => false,
    )
    try {
      await mkdirPrivate(out)
      await chmod(out, 0o700)
      const files: ManifestEntry[] = []
      for (const name of names) {
        const dir = options.roots[name]
        const link = await lstat(dir).catch(() => undefined)
        if (link?.isSymbolicLink() === true) {
          throw new BackupError(`root "${name}" ${dir} is a symbolic link; a backup follows none`, {
            path: dir,
          })
        }
        const info = await stat(dir).catch(() => undefined)
        if (!info?.isDirectory()) {
          throw new BackupError(`root "${name}" ${dir} is not a directory`, { path: dir })
        }
        await mkdirPrivate(join(out, name))
        // A sidecar of an excluded database is excluded too: its WAL can hold the excluded rows.
        const excluded = (rel: string): boolean => {
          if (options.exclude?.(name, rel) === true) return true
          const base = sidecarOf(rel)
          if (base === undefined || options.exclude?.(name, base) !== true) return false
          // Only a real SQLite database has sidecars; `notes-journal` beside `notes` is an ordinary file.
          try {
            return isSQLite(join(dir, base))
          } catch (error) {
            const code = (error as NodeJS.ErrnoException).code
            // No such file or a directory: the name is not a database. Anything else means we cannot tell,
            // and copying its sidecars could leak the excluded rows.
            if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR') return false
            throw new BackupError(`cannot inspect excluded database ${join(dir, base)}`, {
              path: join(dir, base),
              cause: error,
            })
          }
        }
        const listed = await listFiles(dir, excluded)
        const listedSet = new Set(listed)
        for (const rel of listed) {
          const base = sidecarOf(rel)
          if (base !== undefined && listedSet.has(base) && isSQLite(join(dir, base))) continue
          const target = join(out, name, rel)
          await copyOne(join(dir, rel), target)
          const size = (await stat(target)).size
          files.push({ path: `${name}/${rel}`, sha256: await sha256File(target), size })
          options.onFileCopied?.(`${name}/${rel}`)
        }
      }
      const manifest: BackupManifest = { version: 1, files, roots: names }
      await replaceFileAtomic(join(out, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`, {
        mode: 0o600,
      })
      return manifest
    } catch (error) {
      await rm(out, { recursive: true, force: true }).catch(() => undefined)
      if (existed) await mkdirPrivate(out).catch(() => undefined)
      throw error
    }
  })
}
