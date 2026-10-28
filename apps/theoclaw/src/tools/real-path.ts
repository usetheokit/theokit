import { lstatSync, readlinkSync, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

/** Symlinks followed before a path is refused as unresolvable, as the kernel's own limit. */
const MAX_SYMLINK_HOPS = 40

/** A path that goes through more symlinks than the kernel would follow. */
export class SymlinkLoopError extends Error {}

function lexists(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/**
 * `path` with its nearest existing ancestor replaced by that ancestor's real path, so a symlink is
 * followed and a directory that does not exist yet is placed where its symlinked parent points. A
 * dangling symlink counts as existing (`lstat`), and its target is followed the same way, so a link
 * towards a file that does not exist yet is still placed at its target. Throws `SymlinkLoopError`
 * past the kernel's hop limit.
 */
export function realPathOf(path: string, hops = 0): string {
  if (hops > MAX_SYMLINK_HOPS) throw new SymlinkLoopError(`${path} goes through more than ${MAX_SYMLINK_HOPS} symlinks`)
  let existing = resolve(path)
  const rest: string[] = []
  while (!lexists(existing) && dirname(existing) !== existing) {
    rest.unshift(basename(existing))
    existing = dirname(existing)
  }
  try {
    return join(realpathSync(existing), ...rest)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    // `existing` is a dangling symlink: follow its target.
    return realPathOf(join(resolve(dirname(existing), readlinkSync(existing)), ...rest), hops + 1)
  }
}

/**
 * True when `path` is `directory` or lies inside it, both compared as given. `caseFold` compares
 * them lowercased, for a check that must also hold on a case-insensitive filesystem (APFS).
 */
export function isWithin(path: string, directory: string, options: { readonly caseFold?: boolean } = {}): boolean {
  const fold = (value: string): string => (options.caseFold === true ? value.toLowerCase() : value)
  const offset = relative(fold(directory), fold(path))
  return offset === '' || (offset !== '..' && !offset.startsWith(`..${sep}`) && !isAbsolute(offset))
}
