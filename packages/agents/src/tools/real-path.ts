import { lstatSync, readlinkSync, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import { TheokitAgentError } from '@theokit/sdk/errors'

/** Symlinks followed before a path is refused as unresolvable, as the kernel's own limit. */
const DEFAULT_MAX_HOPS = 40

/** A path that goes through more symlinks than the kernel would follow, or through a loop. */
export class SymlinkLoopError extends TheokitAgentError {
  override readonly name = 'SymlinkLoopError'
  constructor(message: string) {
    super(message, { code: 'SYMLINK_LOOP', isRetryable: false })
  }
}

function lexists(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

function resolveWithHops(path: string, hops: number, maxHops: number): string {
  if (hops > maxHops)
    throw new SymlinkLoopError(`${path} goes through more than ${maxHops} symlinks`)
  let existing = resolve(path)
  const rest: string[] = []
  while (!lexists(existing) && dirname(existing) !== existing) {
    rest.unshift(basename(existing))
    existing = dirname(existing)
  }
  try {
    return join(realpathSync(existing), ...rest)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ELOOP') throw new SymlinkLoopError(`${path} goes through a symlink loop`)
    if (code !== 'ENOENT') throw error
    // `existing` is a dangling symlink: follow its target.
    return resolveWithHops(
      join(resolve(dirname(existing), readlinkSync(existing)), ...rest),
      hops + 1,
      maxHops,
    )
  }
}

/**
 * `path` with its nearest existing ancestor replaced by that ancestor's real path, so a symlink is
 * followed and a directory that does not exist yet is placed where its symlinked parent points. A
 * dangling symlink counts as existing, and its target is followed the same way. Throws
 * `SymlinkLoopError` past `maxHops` (default 40) or on a loop.
 */
export function resolveRealPath(path: string, options: { readonly maxHops?: number } = {}): string {
  return resolveWithHops(path, 0, options.maxHops ?? DEFAULT_MAX_HOPS)
}

/**
 * True when `path` is `directory` or lies inside it, both compared as given. `caseFold` compares
 * them lowercased, for a check that must also hold on a case-insensitive filesystem (APFS).
 */
export function isWithin(
  path: string,
  directory: string,
  options: { readonly caseFold?: boolean } = {},
): boolean {
  const fold = (value: string): string => (options.caseFold === true ? value.toLowerCase() : value)
  const offset = relative(fold(directory), fold(path))
  return offset === '' || (offset !== '..' && !offset.startsWith(`..${sep}`) && !isAbsolute(offset))
}
