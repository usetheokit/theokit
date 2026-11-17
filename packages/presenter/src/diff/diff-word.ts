import { diffWordsWithSpace } from 'diff'

import type { DiffLine } from './diff.js'

export interface WordSegment {
  text: string
  /** True when this segment differs from the paired line. */
  changed: boolean
}

/** Segment `side` of a word diff between `oldText` and `newText`. */
export function segmentWords(oldText: string, newText: string, side: 'old' | 'new'): WordSegment[] {
  const out: WordSegment[] = []
  for (const part of diffWordsWithSpace(oldText, newText)) {
    if (side === 'old' ? part.added : part.removed) continue
    out.push({ text: part.value, changed: side === 'old' ? part.removed : part.added })
  }
  return out
}

/** Pair each run of deleted lines with the following run of added lines, index by index. */
export function pairIntraLines(lines: readonly DiffLine[]): Map<DiffLine, WordSegment[]> {
  const map = new Map<DiffLine, WordSegment[]>()
  let i = 0
  while (i < lines.length) {
    if (lines[i].kind !== 'del') {
      i++
      continue
    }
    const dels: DiffLine[] = []
    while (i < lines.length && lines[i].kind === 'del') dels.push(lines[i++])
    const adds: DiffLine[] = []
    while (i < lines.length && lines[i].kind === 'add') adds.push(lines[i++])
    const m = Math.min(dels.length, adds.length)
    for (let k = 0; k < m; k++) {
      map.set(dels[k], segmentWords(dels[k].text, adds[k].text, 'old'))
      map.set(adds[k], segmentWords(dels[k].text, adds[k].text, 'new'))
    }
  }
  return map
}
