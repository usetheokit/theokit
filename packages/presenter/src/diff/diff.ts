/**
 * The one unified-diff model for UI kits. Data only: no React, no zod, no rendering.
 */
import parseDiff from 'parse-diff'

export type DiffLineKind = 'add' | 'del' | 'context'

export interface DiffLine {
  kind: DiffLineKind
  oldLine?: number
  newLine?: number
  text: string
}

export interface DiffFile {
  oldName?: string
  newName?: string
  lines: DiffLine[]
  additions: number
  deletions: number
}

export interface DiffFold {
  kind: 'fold'
  hidden: number
}

export type DiffRow = DiffLine | DiffFold

/** Thrown when a non-empty patch contains no parseable file. Extends `TypeError` for old catchers. */
export class DiffParseError extends TypeError {
  readonly code = 'diff_unparseable' as const
  constructor(message = 'unified diff could not be parsed') {
    super(message)
    this.name = 'DiffParseError'
  }
}

function cleanName(name: string | undefined): string | undefined {
  return name === undefined || name === '/dev/null' ? undefined : name
}

/** Parse a (possibly multi-file) unified diff. `[]` for an empty patch. */
export function parseUnifiedDiff(patch: string): DiffFile[] {
  if (patch.trim() === '') return []
  const files: DiffFile[] = []
  for (const f of parseDiff(patch)) {
    const lines: DiffLine[] = []
    for (const chunk of f.chunks) {
      for (const c of chunk.changes) {
        if (c.type === 'add') {
          lines.push({ kind: 'add', newLine: c.ln, text: c.content.slice(1) })
        } else if (c.type === 'del') {
          lines.push({ kind: 'del', oldLine: c.ln, text: c.content.slice(1) })
        } else {
          lines.push({ kind: 'context', oldLine: c.ln1, newLine: c.ln2, text: c.content.slice(1) })
        }
      }
    }
    files.push({
      oldName: cleanName(f.from),
      newName: cleanName(f.to),
      lines,
      additions: f.additions,
      deletions: f.deletions,
    })
  }
  if (files.length === 0) throw new DiffParseError()
  return files
}

/** Keep `contextLines` of context around each change and fold the rest. */
export function foldDiffLines(lines: DiffLine[], contextLines: number): DiffRow[] {
  const keep = new Array<boolean>(lines.length).fill(false)
  const n = Math.max(0, contextLines)
  lines.forEach((l, i) => {
    if (l.kind === 'context') return
    for (let j = Math.max(0, i - n); j <= Math.min(lines.length - 1, i + n); j++) keep[j] = true
  })
  const rows: DiffRow[] = []
  let hidden = 0
  lines.forEach((l, i) => {
    if (keep[i]) {
      if (hidden > 0) rows.push({ kind: 'fold', hidden })
      hidden = 0
      rows.push(l)
    } else hidden++
  })
  if (hidden > 0) rows.push({ kind: 'fold', hidden })
  return rows
}
