/** The shape the event stream hands the renderer. Narrowed here, not trusted. */
export interface ToolChunk {
  readonly toolName?: string
  readonly input?: unknown
}

const MAX_JSON = 200
const MAX_PATCH_LINES = 40

/**
 * One line per tool call on the headless surface — except a patch, which gets its body.
 *
 * The generic form is `exec <name> <json>`, and for most tools it is the right one:
 * `exec read_file {"path":"tax.mjs"}` says everything in a line. `apply_patch` is where it collapses.
 * Its input is a whole diff, so `JSON.stringify` turns the one tool call a reader most wants to read
 * into a single line of escaped text with literal `\n` where the newlines were.
 *
 * The TUI has never had this problem — `formatToolHeader` renders `Edited <files> (+N -M)` there.
 * This is the same knowledge reaching the surface that was built without it.
 *
 * ## Truncation is announced
 *
 * The old line ended in `.slice(0, 200)`, which cuts a real multi-hunk patch mid-line and says
 * nothing. A log showing half an edit, with nothing marking the missing half, is worse than a long
 * line: the reader has no way to know they are looking at a fragment. Both limits here name what
 * they dropped.
 *
 * ## Hostile input
 *
 * `input` crosses from a model. Every branch narrows before it reads and falls back to the generic
 * line, because a renderer that throws on an unexpected shape takes down a turn that was merely
 * going wrong.
 */
export function toolLine(chunk: ToolChunk): string {
  const name = chunk.toolName ?? 'tool'
  const patch = patchBody(chunk)
  if (patch !== undefined) return `exec ${name}\n${patch}`
  return `exec ${name} ${JSON.stringify(chunk.input ?? {}).slice(0, MAX_JSON)}`
}

function patchBody(chunk: ToolChunk): string | undefined {
  if (chunk.toolName !== 'apply_patch') return undefined
  const input = chunk.input
  if (typeof input !== 'object' || input === null) return undefined
  const patch = (input as { patch?: unknown }).patch
  if (typeof patch !== 'string' || patch.length === 0) return undefined

  const lines = patch.split('\n')
  if (lines.length <= MAX_PATCH_LINES) return patch
  const dropped = lines.length - MAX_PATCH_LINES
  return `${lines.slice(0, MAX_PATCH_LINES).join('\n')}\n… truncated — ${dropped} more line${dropped === 1 ? '' : 's'}`
}
