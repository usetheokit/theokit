/**
 * The one rule every generator applies before writing: the file stays inside the project. Shared
 * by `generate` and the schedule generator, which checks it before looking for the chat agent so an
 * `agentsDir` outside the project is refused as traversal, never reported as a missing agent there.
 */
import { isAbsolute, relative, resolve, sep } from 'node:path'

import type { GenerateResult } from './generate-types.js'

/**
 * Whether `filePath` lies strictly inside `cwd`. Decided by `path.relative`, never by a string
 * prefix: `/tmp/x/app-outside/...` starts with `/tmp/x/app` and is still outside it. A null byte,
 * an absolute path and a `..` escape are all outside.
 */
function isPathInside(cwd: string, filePath: string): boolean {
  if (filePath.includes('\x00')) return false
  const fromRoot = relative(resolve(cwd), filePath)
  return fromRoot !== '' && !isAbsolute(fromRoot) && fromRoot.split(sep)[0] !== '..'
}

/** The refusal for a `filePath` outside the project at `cwd`, or `undefined` when it is inside. */
export function pathTraversalRefusal(cwd: string, filePath: string): GenerateResult | undefined {
  if (isPathInside(cwd, filePath)) return undefined
  return {
    status: 'invalid_name',
    message: `Path traversal denied: "${filePath}" is outside the project root ${resolve(cwd)}.`,
  }
}
