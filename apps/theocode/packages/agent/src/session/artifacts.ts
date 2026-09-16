// The union, written directly: the `as const` list existed only to derive this type, and nothing
// walked it at runtime. An array kept alive for a single `typeof` is dead data wearing the shape of
// live data — it reads as a registry something iterates, and no such caller exists.
export type ArtifactKind = 'transcript' | 'lock-file' | 'lock-directory' | 'tmp'

export function classifyEntry(name: string, isDirectory: boolean): ArtifactKind | undefined {
  if (name.endsWith('.jsonl.lock')) return isDirectory ? 'lock-directory' : undefined
  if (isDirectory) return undefined
  if (name.endsWith('.jsonl')) return 'transcript'
  if (name.endsWith('.writer.lock')) return 'lock-file'
  if (name.endsWith('.tmp')) return 'tmp'
  return undefined
}
