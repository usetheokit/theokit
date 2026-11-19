import { lstatSync, readlinkSync } from 'node:fs'
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path'

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

/** The non-empty components of `path`, without its root. */
function components(path: string): string[] {
  return path
    .slice(parse(path).root.length)
    .split(sep)
    .filter((part) => part !== '')
}

/**
 * `path` with every symlink followed and counted, so a directory that does not exist yet is placed
 * where its symlinked parent points. A dangling symlink is followed to its target. Throws
 * `SymlinkLoopError` past `maxHops` (default 40) symlinks, or when the kernel reports a loop.
 */
export function resolveRealPath(path: string, options: { readonly maxHops?: number } = {}): string {
  const maxHops = options.maxHops ?? DEFAULT_MAX_HOPS
  const start = resolve(path)
  let current = parse(start).root
  let queue = components(start)
  let hops = 0
  while (queue.length > 0) {
    const part = queue[0] as string
    queue = queue.slice(1)
    if (part === '.') continue
    if (part === '..') {
      current = dirname(current)
      continue
    }
    const next = join(current, part)
    let isLink: boolean
    try {
      isLink = lstatSync(next).isSymbolicLink()
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ELOOP') throw new SymlinkLoopError(`${path} goes through a symlink loop`)
      // Nothing from here on exists yet: place the rest under the real ancestor.
      if (code === 'ENOENT' || code === 'ENOTDIR') return join(next, ...queue)
      throw error
    }
    if (!isLink) {
      current = next
      continue
    }
    hops += 1
    if (hops > maxHops) {
      throw new SymlinkLoopError(`${path} goes through more than ${maxHops} symlinks`)
    }
    const target = readlinkSync(next)
    if (isAbsolute(target)) current = parse(target).root
    queue = [...components(isAbsolute(target) ? target : sep + target), ...queue]
  }
  return current
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
