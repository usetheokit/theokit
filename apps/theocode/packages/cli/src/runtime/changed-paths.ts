import type { ToolChunk } from './tool-line.js'

/**
 * #105 — the files a turn wrote, collected from the write-scoped calls it made.
 *
 * ## Why not the working tree
 *
 * Codex ends a turn by printing `git diff` of the tree, and in a clean checkout that is exactly
 * right. In a repository that was already dirty it prints the operator's own uncommitted work
 * alongside the agent's, with nothing separating them — so the one question the output exists to
 * answer, *what did this turn change?*, is the one it stops answering.
 *
 * The agent's own tool calls carry the answer, so the scope comes from them.
 *
 * ## Why the tool names are a literal set
 *
 * `WRITE_SCOPED_TOOLS` in `@theokit/agents` is the framework's list and this could import it. It
 * deliberately does not: that set governs APPROVAL, and a tool could reasonably be added to it that
 * writes nothing a diff would show (a network POST, a memory write). Sharing the list would make a
 * change to the approval policy silently change what this prints. Two short lists that mean two
 * different things beat one list meaning both.
 *
 * ## Hostile input
 *
 * `input` crosses from a model. Every branch narrows before it reads and skips what it cannot
 * parse, for the reason `tool-line.ts` gives for the surface beside this one: a collector that
 * threw on an unexpected shape would take down a turn that was merely going somewhere odd.
 */

/** Tools that name their target in a `path` field. */
const PATH_FIELD_TOOLS: ReadonlySet<string> = new Set(['write_file', 'edit_file'])

/** `*** Add File: x`, `*** Update File: x`, `*** Delete File: x` — the three headers a patch uses. */
const PATCH_HEADER = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/

export function changedPaths(chunks: readonly ToolChunk[]): string[] {
  const seen = new Set<string>()
  for (const chunk of chunks) {
    for (const p of pathsIn(chunk)) if (p.length > 0) seen.add(p)
  }
  return [...seen]
}

function pathsIn(chunk: ToolChunk): string[] {
  const input = chunk.input
  if (typeof input !== 'object' || input === null) return []

  if (chunk.toolName === 'apply_patch') {
    const patch = (input as { patch?: unknown }).patch
    if (typeof patch !== 'string') return []
    return patch
      .split('\n')
      .map((line) => PATCH_HEADER.exec(line.trim())?.[1]?.trim())
      .filter((p): p is string => p !== undefined)
  }

  if (chunk.toolName !== undefined && PATH_FIELD_TOOLS.has(chunk.toolName)) {
    const path = (input as { path?: unknown }).path
    return typeof path === 'string' ? [path] : []
  }
  return []
}
