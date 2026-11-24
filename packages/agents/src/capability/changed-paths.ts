/**
 * The files a turn wrote, collected from the write-scoped tool calls it made.
 *
 * `input` crosses from a model, so every branch narrows before it reads and skips what it cannot
 * parse. Failed calls count: the list is the paths the turn ATTEMPTED to write, and git decides
 * what actually changed.
 */
export type ChangedPathsTool = 'write_file' | 'edit_file' | 'apply_patch'

export interface ChangedPathsOptions {
  /** Maps a caller's tool names onto the canonical ones, e.g. `{ Edit: 'edit_file' }`. */
  readonly aliases?: Readonly<Record<string, ChangedPathsTool>>
}

const CANONICAL: ReadonlySet<string> = new Set<ChangedPathsTool>([
  'write_file',
  'edit_file',
  'apply_patch',
])

/** `*** Add File: x`, `*** Update File: x`, `*** Delete File: x`. */
const PATCH_HEADER = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/

/** Paths written by the turn's tool calls, deduplicated, in call order. */
export function changedPathsOf(
  calls: Iterable<{ toolName: string; input: unknown }>,
  options: ChangedPathsOptions = {},
): string[] {
  const seen = new Set<string>()
  for (const call of calls) {
    const tool = canonicalTool(call.toolName, options.aliases)
    if (tool === undefined) continue
    for (const p of pathsIn(tool, call.input)) if (p.length > 0) seen.add(p)
  }
  return [...seen]
}

function canonicalTool(
  name: string,
  aliases: ChangedPathsOptions['aliases'],
): ChangedPathsTool | undefined {
  const aliased =
    aliases !== undefined && Object.prototype.hasOwnProperty.call(aliases, name)
      ? aliases[name]
      : undefined
  const resolved = aliased ?? name
  return CANONICAL.has(resolved) ? (resolved as ChangedPathsTool) : undefined
}

function pathsIn(tool: ChangedPathsTool, input: unknown): string[] {
  if (typeof input !== 'object' || input === null) return []
  if (tool === 'apply_patch') {
    const patch = (input as { patch?: unknown }).patch
    if (typeof patch !== 'string') return []
    return patch
      .split('\n')
      .map((line) => PATCH_HEADER.exec(line.trim())?.[1]?.trim())
      .filter((p): p is string => p !== undefined)
  }
  const path = (input as { path?: unknown }).path
  return typeof path === 'string' ? [path] : []
}
