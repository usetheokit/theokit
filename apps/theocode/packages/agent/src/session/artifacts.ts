import { atomicWriteTempTarget } from '@theokit/agents/persistence'

// The union, written directly: the `as const` list existed only to derive this type, and nothing
// walked it at runtime. An array kept alive for a single `typeof` is dead data wearing the shape of
// live data — it reads as a registry something iterates, and no such caller exists.
export type ArtifactKind = 'transcript' | 'lock-file' | 'lock-directory' | 'tmp'

export function classifyEntry(name: string, isDirectory: boolean): ArtifactKind | undefined {
  if (name.endsWith('.jsonl.lock')) return isDirectory ? 'lock-directory' : undefined
  if (isDirectory) return undefined
  if (name.endsWith('.jsonl')) return 'transcript'
  if (name.endsWith('.writer.lock')) return 'lock-file'
  // The SDK owns what its own temp files look like (`<file>.<pid>.<16 hex>.tmp`). Matching any
  // `.tmp` would claim editors' swap files and other tools' scratch, on a deleting path.
  if (name.endsWith('.tmp')) return atomicWriteTempTarget(name) === undefined ? undefined : 'tmp'
  return undefined
}
