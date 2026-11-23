import type { SourceOrigin } from '@theokit/agents/auth'

export type { SourceOrigin }

/**
 * `loadedKeys` are the keys the bootstrap's project-env step assigned from `.env`: a variable the
 * shell already had is not among them, so it is labelled `(shell)`.
 */
export function describeSource(
  origin: SourceOrigin,
  loadedKeys: ReadonlySet<string>,
  dotenvPath: string,
): string {
  if (origin.kind === 'oauth') return `oauth (${origin.provider})`
  if (origin.kind === 'file') return origin.path
  return loadedKeys.has(origin.varName)
    ? `${origin.varName} (${dotenvPath})`
    : `${origin.varName} (shell)`
}
