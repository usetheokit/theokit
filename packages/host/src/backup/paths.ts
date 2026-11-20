import { randomBytes } from 'node:crypto'
import { existsSync, realpathSync } from 'node:fs'
import { lstat, mkdir, readdir } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'

import { BackupError } from './errors.js'

export type BackupRoots = Readonly<Record<string, string>>

const ROOT_NAME = /^[a-z0-9-]+$/

/** True when `child` is `parent` or lies inside it. A sibling sharing a name prefix is not inside. */
function within(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent.endsWith(sep) ? parent : `${parent}${sep}`)
}

/** The real path of `path`, through its nearest existing ancestor when it does not exist yet. */
export function realOrResolved(path: string): string {
  const absolute = resolve(path)
  if (existsSync(absolute)) return realpathSync(absolute)
  const parent = dirname(absolute)
  return parent === absolute ? absolute : join(realOrResolved(parent), basename(absolute))
}

export function validateRoots(roots: BackupRoots): void {
  const names = Object.keys(roots)
  if (names.length === 0) throw new BackupError('at least one root is required')
  for (const name of names) {
    if (!ROOT_NAME.test(name)) throw new BackupError(`root name "${name}" must match [a-z0-9-]+`)
    const dir = roots[name]
    if (!isAbsolute(dir))
      throw new BackupError(`root "${name}" must be an absolute directory`, { path: dir })
  }
}

/** Refuse equal or nested paths among the given directories (compared by real path). */
export function assertDisjoint(entries: readonly (readonly [label: string, path: string])[]): void {
  const real = entries.map(([label, path]) => [label, path, realOrResolved(path)] as const)
  for (const [i, a] of real.entries()) {
    for (const b of real.slice(i + 1)) {
      if (within(a[2], b[2]) || within(b[2], a[2])) {
        throw new BackupError(`${a[0]} ${a[1]} and ${b[0]} ${b[1]} overlap`, { path: a[1] })
      }
    }
  }
}

export async function mkdirPrivate(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 })
}

export async function isEmptyOrAbsent(path: string): Promise<boolean> {
  try {
    const entry = await lstat(path)
    return entry.isDirectory() && (await readdir(path)).length === 0
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true
    throw error
  }
}

/** Every regular file under `dir`, relative to it with `/` separators; a symbolic link is refused naming it. */
export async function listFiles(
  dir: string,
  skip: (relativePath: string) => boolean,
  prefix = '',
): Promise<string[]> {
  const files: string[] = []
  for (const name of (await readdir(dir)).sort((x, y) => x.localeCompare(y))) {
    const relative = prefix === '' ? name : `${prefix}/${name}`
    const path = join(dir, name)
    const entry = await lstat(path)
    if (entry.isSymbolicLink()) {
      throw new BackupError(`${path} is a symbolic link; a backup follows none`, { path })
    }
    if (skip(relative)) continue
    if (entry.isDirectory()) files.push(...(await listFiles(path, skip, relative)))
    else if (entry.isFile()) files.push(relative)
  }
  return files
}

export function tempSibling(target: string, tag: string): string {
  return `${target}.${tag}-${randomBytes(6).toString('hex')}`
}
