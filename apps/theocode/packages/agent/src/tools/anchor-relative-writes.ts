import { isAbsolute, resolve } from 'node:path'

import type { CustomTool } from '@theokit/agents'

/**
 * #939: under `danger-full-access` the write root is `/`, and the SDK write tools resolve a relative
 * path against their root, so `hello.txt` became `/hello.txt`. The project is where a relative path
 * points; the widened root exists only to let absolute paths through.
 *
 * The SDK tools take one `projectRoot` that is both the boundary and the base for relative paths,
 * so the base is fixed here, before the input reaches them, by making each relative path absolute.
 */

/** The V4A lines that carry a path, exactly as the SDK parser matches them (`startsWith`). */
const PATCH_PATH_HEADERS = [
  '*** Add File: ',
  '*** Delete File: ',
  '*** Update File: ',
  '*** Move to: ',
] as const

function anchorPath(path: string, cwd: string): string {
  return isAbsolute(path) ? path : resolve(cwd, path)
}

/** Rewrites the path on every header line; body lines (`+`, `-`, ` `) are left as written. */
function anchorPatchPaths(patch: string, cwd: string): string {
  return patch
    .split('\n')
    .map((line) => {
      const header = PATCH_PATH_HEADERS.find((prefix) => line.startsWith(prefix))
      if (header === undefined) return line
      const carriageReturn = line.endsWith('\r') ? '\r' : ''
      const path = line.slice(header.length, line.length - carriageReturn.length).trim()
      return `${header}${anchorPath(path, cwd)}${carriageReturn}`
    })
    .join('\n')
}

/**
 * The same tool, with its path-carrying input field made absolute against `cwd` first. `field`
 * names where the path lives: the whole V4A patch for `ApplyPatch`, the `path` for `Edit`.
 */
export function anchorRelativeWrites(
  tool: CustomTool,
  cwd: string,
  field: 'patch' | 'path',
): CustomTool {
  const handler = tool.handler
  return {
    ...tool,
    handler: (input: Record<string, unknown>, ctx: unknown) => {
      const value = input[field]
      if (typeof value !== 'string') return handler(input, ctx as never)
      const anchored = field === 'patch' ? anchorPatchPaths(value, cwd) : anchorPath(value, cwd)
      return handler({ ...input, [field]: anchored }, ctx as never)
    },
  } as CustomTool
}
