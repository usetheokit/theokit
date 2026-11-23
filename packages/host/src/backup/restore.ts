import { copyFile, chmod, lstat, rename, rm, rmdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { withLock, type BackupLock } from './backup.js'
import { BackupError } from './errors.js'
import { readManifest, sha256File, splitEntryPath, type BackupManifest } from './manifest.js'
import {
  assertDisjoint,
  mkdirPrivate,
  tempSibling,
  validateRoots,
  type BackupRoots,
} from './paths.js'

export interface RestoreOptions {
  readonly from: string
  readonly roots: BackupRoots
  readonly lock?: BackupLock
  /**
   * Maps an archived path (relative to its root, `/`-separated) to the path written below that
   * root's target, so an app can re-key paths that encode an absolute directory. The result must
   * stay inside the root and may not collide with another file's destination.
   */
  readonly transform?: (relativePath: string, root: string) => string
}

/** Refuse a symbolic link in any component of `relative` below `base`. */
async function assertNoLinks(base: string, relative: string): Promise<void> {
  let current = base
  for (const part of relative.split('/')) {
    current = join(current, part)
    const entry = await lstat(current).catch((cause: unknown) => {
      throw new BackupError(`backup file ${current} is missing`, { path: current, cause })
    })
    if (entry.isSymbolicLink()) {
      throw new BackupError(`${current} is a symbolic link; a restore follows none`, {
        path: current,
      })
    }
  }
}

async function verify(path: string, sha256: string, size: number): Promise<void> {
  const entry = await lstat(path).catch((cause: unknown) => {
    throw new BackupError(`backup file ${path} is missing`, { path, cause })
  })
  if (!entry.isFile() || entry.size !== size || (await sha256File(path)) !== sha256) {
    throw new BackupError(`backup file ${path} does not match its manifest`, { path })
  }
}

/** Create `dir` privately, recording each directory in `created` (outermost first) as soon as it exists. */
async function mkdirTracked(dir: string, created: string[]): Promise<void> {
  const missing: string[] = []
  for (let d = dir; ; d = dirname(d)) {
    if (
      await lstat(d).then(
        () => true,
        () => false,
      )
    )
      break
    missing.unshift(d)
    if (dirname(d) === d) break
  }
  for (const d of missing) {
    await mkdirPrivate(d)
    created.push(d)
  }
}

/** Test seam: the rename used to place directories. */
export interface RestoreFs {
  readonly rename: (from: string, to: string) => Promise<void>
}

export async function restoreWith(options: RestoreOptions, fs: RestoreFs): Promise<BackupManifest> {
  validateRoots(options.roots)
  return withLock(options.lock, async () => {
    const manifest = await readManifest(options.from)
    for (const name of manifest.roots) {
      if (!Object.hasOwn(options.roots, name)) {
        throw new BackupError(`backup root "${name}" has no target`, { path: options.from })
      }
    }
    assertDisjoint([
      ...manifest.roots.map((name) => [`root "${name}"`, options.roots[name]] as const),
      ['backup', options.from],
    ])
    // Nothing is written until every file matches its manifest entry.
    for (const entry of manifest.files) {
      splitEntryPath(entry.path, manifest.roots)
      await assertNoLinks(options.from, entry.path)
      await verify(join(options.from, entry.path), entry.sha256, entry.size)
    }
    const destinations = new Map<string, string>()
    const seenDestinations = new Set<string>()
    for (const entry of manifest.files) {
      const { root, relative } = splitEntryPath(entry.path, manifest.roots)
      const mapped = options.transform === undefined ? relative : options.transform(relative, root)
      if (
        options.transform !== undefined &&
        (typeof mapped !== 'string' ||
          mapped.includes('\0') ||
          mapped.includes('\\') ||
          mapped.startsWith('/') ||
          mapped.split('/').some((part) => part === '' || part === '.' || part === '..'))
      ) {
        throw new BackupError(`transform mapped "${entry.path}" outside its root`, {
          path: entry.path,
        })
      }
      const key = `${root}/${mapped}`
      if (seenDestinations.has(key)) {
        throw new BackupError(`transform maps two files to "${key}"`, { path: entry.path })
      }
      seenDestinations.add(key)
      destinations.set(entry.path, mapped)
    }
    const stages = new Map<string, string>()
    const previous = new Map<string, string>()
    const placed: string[] = []
    const createdParents: string[] = []
    try {
      for (const name of manifest.roots) {
        const target = options.roots[name]
        await mkdirTracked(dirname(target), createdParents)
        const stage = tempSibling(target, 'restore')
        stages.set(name, stage)
        await mkdirPrivate(stage)
      }
      for (const entry of manifest.files) {
        const { root } = splitEntryPath(entry.path, manifest.roots)
        const to = join(stages.get(root)!, destinations.get(entry.path)!)
        await mkdirPrivate(dirname(to))
        await copyFile(join(options.from, entry.path), to)
        await chmod(to, 0o600)
        await verify(to, entry.sha256, entry.size)
      }
      for (const name of manifest.roots) {
        const target = options.roots[name]
        const exists = await lstat(target).then(
          () => true,
          () => false,
        )
        if (exists) {
          const aside = tempSibling(target, 'previous')
          await fs.rename(target, aside)
          previous.set(name, aside)
        }
        await fs.rename(stages.get(name)!, target)
        placed.push(name)
      }
    } catch (error) {
      const problems: unknown[] = []
      for (const name of manifest.roots) {
        const target = options.roots[name]
        const aside = previous.get(name)
        try {
          if (placed.includes(name)) await rm(target, { recursive: true, force: true })
          if (aside !== undefined) {
            const targetGone = await lstat(target).then(
              () => false,
              () => true,
            )
            if (targetGone) await rename(aside, target)
          }
        } catch (rollback) {
          problems.push(rollback)
        }
      }
      for (const stage of stages.values())
        await rm(stage, { recursive: true, force: true }).catch(() => undefined)
      // Remove, innermost first, the parent directories this restore created; a non-empty one stays.
      const innermostFirst = [...createdParents]
      innermostFirst.reverse()
      for (const dir of innermostFirst) await rmdir(dir).catch(() => undefined)
      if (problems.length > 0) {
        throw new BackupError(
          `restore failed and rollback was incomplete; previous directories remain beside their targets: ${String(error)}`,
          { cause: new AggregateError([error, ...problems], 'restore and rollback failures') },
        )
      }
      throw error
    }
    for (const aside of previous.values())
      await rm(aside, { recursive: true, force: true }).catch(() => undefined)
    return manifest
  })
}

/** Verify every file against the manifest, then place each root atomically; a failed placement puts back the earlier targets. */
export function restore(options: RestoreOptions): Promise<BackupManifest> {
  return restoreWith(options, { rename })
}
